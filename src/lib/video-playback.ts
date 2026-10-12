/**
 * Provider → playback sources for a Video row. Client-safe (no server imports).
 *
 * Video.metadata shapes (JSONB):
 *
 *   provider "mux" (legacy, until scripts/migrate-mux-to-self.mjs ran):
 *     { playbackId, poster (image.mux.com), aspectRatio?, blurDataURL?, status }
 *     Played from Mux's public HLS manifest https://stream.mux.com/{id}.m3u8;
 *     captions come from that manifest (hls.js exposes them as text tracks).
 *
 *   provider "self" (encoded by scripts/video-worker.mjs onto our S3):
 *     { status: 'waiting'|'queued'|'encoding'|'ready'|'errored', progress?,
 *       error?, uploadKey?, hlsUrl, mp4Url, poster, thumbnailsVtt,
 *       captions: [{src, lang, label}], width, height, aspectRatio, duration,
 *       renditions: [720, 480], muxPlaybackId? (set by the migration) }
 *     Until a migrated row is ready, it keeps playing from Mux via
 *     muxPlaybackId (and keeps the Mux poster).
 *
 * Every URL for a ready "self" row points at our S3 (s3.pub1.infomaniak.cloud,
 * CH) — the point of the move (student browsers only talk to CH hosts).
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
  /** WebVTT of sprite tiles for scrub previews (self-hosted only). */
  thumbnailsVtt?: string
}

type Meta = Record<string, unknown> | null | undefined

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function mux(playbackId: string, poster: string | undefined, aspectRatio: number | undefined): VideoPlayback {
  return { hlsUrl: `https://stream.mux.com/${playbackId}.m3u8`, poster, aspectRatio, captions: [] }
}

export function getVideoPlayback(provider: string | undefined, metadata: Meta): VideoPlayback | null {
  if (!metadata) return null
  const aspectRatio = typeof metadata.aspectRatio === 'number' ? metadata.aspectRatio : undefined
  const poster = str(metadata.poster)

  if (provider === 'self') {
    const hlsUrl = str(metadata.hlsUrl)
    if (!hlsUrl || metadata.status !== 'ready') {
      // Migrated row still queued/encoding (or failed): keep playing the Mux
      // original so the page never shows a gap.
      const muxPlaybackId = str(metadata.muxPlaybackId)
      return muxPlaybackId ? mux(muxPlaybackId, poster, aspectRatio) : null
    }
    const captions = Array.isArray(metadata.captions)
      ? (metadata.captions as unknown[]).filter(
          (c): c is VideoCaption =>
            !!c && typeof c === 'object' && typeof (c as VideoCaption).src === 'string'
        )
      : []
    return { hlsUrl, poster, aspectRatio, captions, thumbnailsVtt: str(metadata.thumbnailsVtt) }
  }

  // Default/legacy: Mux
  const playbackId = str(metadata.playbackId)
  return playbackId ? mux(playbackId, poster, aspectRatio) : null
}

/** True while the encoder still has to finish this row. */
export function isVideoPending(metadata: Meta): boolean {
  const status = metadata?.status
  return status === 'waiting' || status === 'queued' || status === 'encoding' || status === 'processing'
}
