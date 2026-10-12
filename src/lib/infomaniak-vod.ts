/**
 * Infomaniak VOD API client (CH-hosted video encoding + delivery).
 *
 * Plain fetch, no '@/' imports: used by the Next app (src/lib/video-sync.server.ts,
 * src/app/api/webhooks/infomaniak-vod) and by the tsx migration script
 * (scripts/migrate-mux-to-infomaniak.ts).
 *
 * API quirks, verified against channel 16211 on 2026-10-12:
 *  - v2 import-from-URL is broken; v1 `POST /1/vod/channel/{ch}/upload` with
 *    {folder, filename, url} works. Infomaniak fetches the URL itself, so a
 *    presigned S3 GET or a public HLS manifest (Mux) both work as a source.
 *  - v2 `GET /2/vod/media/{id}` is the only call that returns ready-to-use
 *    stream URLs (HLS manifest, per-rendition MP4s), the poster and the
 *    display aspect ratio. Its `state` is a string array, ['available','ready']
 *    when playable.
 *  - Subtitles: v1 `POST /1/vod/channel/{ch}/media/{id}/subtitle` starts an AI
 *    transcription (language auto-detected, ~20 s for a short clip); v2
 *    `GET /2/vod/media/{id}/subtitles` lists them, `ready_at` is set once done.
 *  - Callbacks carry the v1 media object + `notification_event`, no
 *    signature, and arrive duplicated — see the webhook route.
 *  - Every delivery host (play.vod2.infomaniak.com, api.infomaniak.com) sends
 *    CORS `*`. Media are public (no token) unless the folder restricts them.
 */

const API = 'https://api.infomaniak.com'

export interface VodConfig {
  token: string
  channel: string
  folder: string
}

export function getVodConfig(env: NodeJS.ProcessEnv = process.env): VodConfig | null {
  const token = env.INFOMANIAK_VOD_TOKEN
  const channel = env.INFOMANIAK_VOD_CHANNEL
  const folder = env.INFOMANIAK_VOD_FOLDER
  if (!token || !channel || !folder) return null
  return { token, channel, folder }
}

export class VodApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'VodApiError'
  }
}

async function vodFetch<T>(config: VodConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await res.text()
  let json: { result?: string; data?: unknown; error?: { code?: string; description?: string } } = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    // non-JSON error page
  }
  if (!res.ok || json.result === 'error') {
    const detail = json.error?.description || json.error?.code || text.slice(0, 200)
    throw new VodApiError(`Infomaniak VOD ${init?.method ?? 'GET'} ${path} → ${res.status}: ${detail}`, res.status)
  }
  return json.data as T
}

/** Start an import; Infomaniak downloads `url` itself. Returns the new media id. */
export async function importFromUrl(config: VodConfig, url: string, filename: string): Promise<string> {
  const data = await vodFetch<{ id?: string }>(config, `/1/vod/channel/${config.channel}/upload`, {
    method: 'POST',
    body: JSON.stringify({ folder: config.folder, filename, url }),
  })
  if (!data?.id) throw new VodApiError('Infomaniak VOD import returned no media id', 502)
  return data.id
}

// Shape of the parts of GET /2/vod/media/{id} we read.
export interface VodMediaRaw {
  id: string
  state?: string[]
  duration?: string | number
  thumbnails?: { poster?: string; image?: string }
  streams?: {
    singles?: Array<{ source?: string; video_height?: number; container?: string }>
    adaptatives?: Array<{ strategy?: string; source?: string }>
    upload?: { display_aspect_ratio?: string; video_width?: number; video_height?: number }
  }
}

export async function getMedia(config: VodConfig, mediaId: string): Promise<VodMediaRaw> {
  return vodFetch<VodMediaRaw>(config, `/2/vod/media/${encodeURIComponent(mediaId)}`)
}

export async function deleteMedia(config: VodConfig, mediaId: string): Promise<void> {
  await vodFetch(config, `/1/vod/channel/${config.channel}/media/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
  })
}

export interface ParsedMedia {
  state: 'processing' | 'ready' | 'failed'
  hlsUrl?: string
  /** Highest-resolution MP4 rendition (download/export). */
  mp4Url?: string
  posterUrl?: string
  /** Seconds. */
  duration?: number
  /** width / height */
  aspectRatio?: number
}

/** "00:07:50.94" | 470.94 → seconds */
function parseDuration(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return value
  if (!value) return undefined
  const parts = value.split(':').map(Number)
  if (parts.some(Number.isNaN)) return undefined
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

function parseAspect(upload: NonNullable<VodMediaRaw['streams']>['upload']): number | undefined {
  const dar = upload?.display_aspect_ratio
  if (dar) {
    const [w, h] = dar.split(':').map(Number)
    if (w && h) return w / h
  }
  if (upload?.video_width && upload?.video_height) return upload.video_width / upload.video_height
  return undefined
}

export function parseMedia(raw: VodMediaRaw): ParsedMedia {
  const states = raw.state ?? []
  const hlsUrl = raw.streams?.adaptatives?.find(a => a.strategy === 'hls')?.source
  const singles = (raw.streams?.singles ?? []).filter(s => s.source && (s.container ?? 'mp4') === 'mp4')
  const highest = singles.reduce<(typeof singles)[number] | undefined>(
    (best, s) => (!best || (s.video_height ?? 0) > (best.video_height ?? 0) ? s : best),
    undefined
  )
  const failed = states.some(s => /error|fail/i.test(s))
  const ready = !failed && states.includes('ready') && !!hlsUrl
  return {
    state: failed ? 'failed' : ready ? 'ready' : 'processing',
    hlsUrl,
    mp4Url: highest?.source,
    posterUrl: raw.thumbnails?.poster ?? raw.thumbnails?.image,
    duration: parseDuration(raw.duration),
    aspectRatio: parseAspect(raw.streams?.upload),
  }
}

export interface VodSubtitle {
  id: string
  lang: string
  label: string
  vttUrl: string
  ready: boolean
}

interface VodSubtitleRaw {
  id: string
  name?: string
  lang?: string
  ready_at?: string | null
  sources?: { vtt?: string }
}

export async function listSubtitles(config: VodConfig, mediaId: string): Promise<VodSubtitle[]> {
  const data = await vodFetch<VodSubtitleRaw[]>(config, `/2/vod/media/${encodeURIComponent(mediaId)}/subtitles`)
  return (data ?? []).map(s => ({
    id: s.id,
    lang: s.lang || 'und',
    label: s.name || s.lang || 'Subtitles',
    vttUrl: s.sources?.vtt || `${API}/2/vod/res/subtitles/${s.id}.vtt`,
    ready: !!s.ready_at,
  }))
}

/** Start AI transcription; language is auto-detected. */
export async function requestSubtitles(config: VodConfig, mediaId: string): Promise<void> {
  await vodFetch(config, `/1/vod/channel/${config.channel}/media/${encodeURIComponent(mediaId)}/subtitle`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
