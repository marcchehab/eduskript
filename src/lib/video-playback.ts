/**
 * Provider → playback sources for a Video row. Client-safe (no server imports).
 *
 * Video.metadata shapes (JSONB, src/lib/video-sync.server.ts writes the
 * Infomaniak one):
 *
 *   provider "mux" (legacy, until scripts/migrate-mux-to-infomaniak.ts ran):
 *     { playbackId, poster (image.mux.com), aspectRatio?, blurDataURL?, status }
 *     Played from Mux's public HLS manifest https://stream.mux.com/{id}.m3u8;
 *     captions come from that manifest (hls.js exposes them as text tracks).
 *
 *   provider "infomaniak":
 *     { status: 'waiting'|'processing'|'ready'|'errored', mediaId, hlsUrl,
 *       mp4Url, poster, aspectRatio, duration, captions: [{src, lang, label}],
 *       captionsStatus: 'pending'|'ready'|'none', uploadKey?, readyAt?,
 *       subtitlesRequestedAt?, posterSource?, muxPlaybackId? (set by
 *       scripts/migrate-mux-to-infomaniak.mjs) }
 *     poster is our own S3 copy when the copy succeeded, else the Infomaniak
 *     URL (posterSource = the Infomaniak URL it was copied from). Until a
 *     migrated row is ready, it keeps playing from Mux via muxPlaybackId (and
 *     keeps the Mux poster).
 *
 * Every URL produced here points at play.vod2.infomaniak.com /
 * api.infomaniak.com / our S3 for "infomaniak" rows — that is the point of the
 * migration (student browsers only talk to CH hosts).
 */

export interface VideoCaption {
  src: string
  lang: string
  label: string
}

export interface VideoPlayback {
  hlsUrl: string
  poster?: string
  aspectRatio?: number
  /** Out-of-band WebVTT tracks. Empty for Mux (captions are in the manifest). */
  captions: VideoCaption[]
}

type Meta = Record<string, unknown> | null | undefined

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

export function getVideoPlayback(provider: string | undefined, metadata: Meta): VideoPlayback | null {
  if (!metadata) return null
  const aspectRatio = typeof metadata.aspectRatio === 'number' ? metadata.aspectRatio : undefined
  const poster = str(metadata.poster)

  if (provider === 'infomaniak') {
    const hlsUrl = str(metadata.hlsUrl)
    if (!hlsUrl || metadata.status !== 'ready') {
      // Migrated row still encoding (or failed) at Infomaniak: keep playing
      // the Mux original so the page never shows a gap.
      const muxPlaybackId = str(metadata.muxPlaybackId)
      return muxPlaybackId
        ? { hlsUrl: `https://stream.mux.com/${muxPlaybackId}.m3u8`, poster, aspectRatio, captions: [] }
        : null
    }
    const captions = Array.isArray(metadata.captions)
      ? (metadata.captions as unknown[]).filter(
          (c): c is VideoCaption =>
            !!c && typeof c === 'object' && typeof (c as VideoCaption).src === 'string'
        )
      : []
    return { hlsUrl, poster, aspectRatio, captions }
  }

  // Default/legacy: Mux
  const playbackId = str(metadata.playbackId)
  if (!playbackId) return null
  return { hlsUrl: `https://stream.mux.com/${playbackId}.m3u8`, poster, aspectRatio, captions: [] }
}

/** True while a row still needs server-side syncing (encoding, poster or captions outstanding). */
export function isVideoPending(metadata: Meta): boolean {
  if (!metadata) return false
  const status = metadata.status
  return status === 'waiting' || status === 'processing' || metadata.captionsStatus === 'pending'
}
