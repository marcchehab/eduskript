/**
 * Infomaniak upload hand-off + sync (src/lib/video-sync.server.ts) against a
 * mocked VOD API, S3 and an in-memory Video row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string; provider: string; filename: string; vodMediaId: string | null; metadata: Record<string, unknown> }
const rows = new Map<string, Row>()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    video: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const r = rows.get(where.id)
        return r ? structuredClone(r) : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.get(where.id)!
        Object.assign(r, structuredClone(data))
        return r
      }),
    },
    // claimSubtitleRequest: UPDATE … WHERE NOT (metadata ? 'subtitlesRequestedAt')
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, at: string, id: string) => {
      const r = rows.get(id)!
      if ('subtitlesRequestedAt' in r.metadata) return 0
      r.metadata = { ...r.metadata, subtitlesRequestedAt: at }
      return 1
    }),
  },
}))

const s3 = vi.hoisted(() => ({
  deleteFromS3: vi.fn(async () => {}),
  generatePresignedDownloadUrl: vi.fn(async () => 'https://s3.example/video-uploads/k.mp4?sig=1'),
  getTeacherBucketName: vi.fn(() => 'teacher-bucket'),
  getTeacherFileUrl: vi.fn((key: string) => `https://s3.example/teacher-bucket/${key}`),
  uploadTeacherFile: vi.fn(async (hash: string) => `files/${hash}.jpg`),
}))
vi.mock('@/lib/s3', () => s3)

const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/skript-files.server', () => ({ invalidateSkriptFiles: invalidate }))

// --- mocked Infomaniak API -------------------------------------------------
let mediaState: string[] = ['encoding', 'available']
let subtitles: Array<{ id: string; lang: string; name: string; ready_at: string | null; sources: { vtt: string } }> = []
const apiCalls: string[] = []

function json(data: unknown) {
  return new Response(JSON.stringify({ result: 'success', data }), { status: 200 })
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  apiCalls.push(`${method} ${url.replace('https://api.infomaniak.com', '')}`)
  if (url.endsWith('/1/vod/channel/16211/upload')) return json({ id: 'MEDIA1' })
  if (url.endsWith('/2/vod/media/MEDIA1')) {
    return json({
      id: 'MEDIA1',
      state: mediaState,
      duration: 15.5,
      thumbnails: { poster: 'https://api.infomaniak.com/2/vod/res/thumbnails/p.jpg' },
      streams: {
        singles: [{ source: 'https://play.vod2.infomaniak.com/single/MEDIA1/e/hi.mp4', video_height: 720, container: 'mp4' }],
        adaptatives: [{ strategy: 'hls', source: 'https://play.vod2.infomaniak.com/hls/MEDIA1/e/,a,.urlset/manifest.m3u8' }],
        upload: { display_aspect_ratio: '16:9' },
      },
    })
  }
  if (url.endsWith('/2/vod/media/MEDIA1/subtitles')) return json(subtitles)
  if (url.endsWith('/1/vod/channel/16211/media/MEDIA1/subtitle')) return json({ id: 'SUB1' })
  if (url.endsWith('/thumbnails/p.jpg')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  return new Response('not found', { status: 404 })
})

beforeEach(() => {
  rows.clear()
  rows.set('v1', {
    id: 'v1',
    provider: 'infomaniak',
    filename: 'clip.mp4',
    vodMediaId: null,
    metadata: { status: 'waiting', uploadKey: 'video-uploads/k.mp4' },
  })
  mediaState = ['encoding', 'available']
  subtitles = []
  apiCalls.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('INFOMANIAK_VOD_TOKEN', 'tok')
  vi.stubEnv('INFOMANIAK_VOD_CHANNEL', '16211')
  vi.stubEnv('INFOMANIAK_VOD_FOLDER', 'FOLDER')
})

describe('startInfomaniakImport', () => {
  it('imports the presigned S3 object once and stores the media id', async () => {
    const { startInfomaniakImport } = await import('@/lib/video-sync.server')
    await startInfomaniakImport('v1')
    expect(s3.generatePresignedDownloadUrl).toHaveBeenCalledWith('video-uploads/k.mp4', 86400, 'teacher-bucket')
    const importCall = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/upload'))!
    expect(JSON.parse(String(importCall[1]!.body))).toEqual({
      folder: 'FOLDER',
      filename: 'clip.mp4',
      url: 'https://s3.example/video-uploads/k.mp4?sig=1',
    })
    expect(rows.get('v1')).toMatchObject({ vodMediaId: 'MEDIA1', metadata: { status: 'processing', mediaId: 'MEDIA1' } })

    // A retry (double click, network retry) doesn't import a second media.
    await startInfomaniakImport('v1')
    expect(apiCalls.filter(c => c.includes('/upload'))).toHaveLength(1)
  })
})

describe('syncInfomaniakVideo', () => {
  async function imported() {
    const mod = await import('@/lib/video-sync.server')
    await mod.startInfomaniakImport('v1')
    apiCalls.length = 0
    return mod
  }

  it('stays processing while encoding', async () => {
    const { syncInfomaniakVideo } = await imported()
    await syncInfomaniakVideo('v1')
    expect(rows.get('v1')!.metadata.status).toBe('processing')
    expect(s3.deleteFromS3).not.toHaveBeenCalled()
  })

  it('on ready: fills URLs, copies the poster, requests subtitles once, deletes the upload', async () => {
    const { syncInfomaniakVideo } = await imported()
    mediaState = ['available', 'ready']

    // Duplicate callbacks arrive concurrently.
    await Promise.all([syncInfomaniakVideo('v1'), syncInfomaniakVideo('v1')])
    await syncInfomaniakVideo('v1')

    const meta = rows.get('v1')!.metadata
    expect(meta).toMatchObject({
      status: 'ready',
      hlsUrl: 'https://play.vod2.infomaniak.com/hls/MEDIA1/e/,a,.urlset/manifest.m3u8',
      mp4Url: 'https://play.vod2.infomaniak.com/single/MEDIA1/e/hi.mp4',
      captionsStatus: 'pending',
      posterSource: 'https://api.infomaniak.com/2/vod/res/thumbnails/p.jpg',
    })
    expect(String(meta.poster)).toMatch(/^https:\/\/s3\.example\/teacher-bucket\/files\//)
    expect(meta.uploadKey).toBeUndefined()
    expect(apiCalls.filter(c => c.startsWith('POST') && c.endsWith('/subtitle'))).toHaveLength(1)
    expect(s3.deleteFromS3).toHaveBeenCalledWith('video-uploads/k.mp4', 'teacher-bucket')

    // Subtitles finish → captions stored, row fully synced, further syncs are free.
    subtitles = [{ id: 'S1', lang: 'de', name: 'Deutsch', ready_at: '2026-10-12T08:00:00Z', sources: { vtt: 'https://api.infomaniak.com/2/vod/res/subtitles/S1.vtt' } }]
    await syncInfomaniakVideo('v1')
    expect(rows.get('v1')!.metadata).toMatchObject({
      captionsStatus: 'ready',
      captions: [{ src: 'https://api.infomaniak.com/2/vod/res/subtitles/S1.vtt', lang: 'de', label: 'Deutsch' }],
    })
    apiCalls.length = 0
    await syncInfomaniakVideo('v1')
    expect(apiCalls).toHaveLength(0)
  })

  it('gives up on captions after the timeout (silent clips)', async () => {
    const { syncInfomaniakVideo, SUBTITLE_TIMEOUT_MS } = await imported()
    mediaState = ['available', 'ready']
    const t0 = new Date('2026-10-12T08:00:00Z')
    await syncInfomaniakVideo('v1', t0)
    await syncInfomaniakVideo('v1', new Date(t0.getTime() + SUBTITLE_TIMEOUT_MS + 1000))
    expect(rows.get('v1')!.metadata.captionsStatus).toBe('none')
  })

  it('marks the row errored when encoding fails', async () => {
    const { syncInfomaniakVideo } = await imported()
    mediaState = ['encoding_failed']
    await syncInfomaniakVideo('v1')
    expect(rows.get('v1')!.metadata.status).toBe('errored')
  })
})
