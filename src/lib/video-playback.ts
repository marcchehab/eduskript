/**
 * Provider → playback sources for a Video row. Client-safe (no server imports).
 *
 * Video.metadata shapes (JSONB):
 *
 *   provider "self" (encoded by scripts/video-worker.mjs onto our S3):
 *     { status: 'waiting'|'queued'|'encoding'|'ready'|'errored', progress?,
 *       error?, uploadKey?, hlsUrl, mp4Url, poster, thumbnailsVtt,
 *       captions: [{src, lang, label}], width, height, aspectRatio, duration,
 *       renditions: [720, 480], muxPlaybackId? (history only, never used) }
 *
 *   provider "mux" (legacy, all migrated by scripts/migrate-mux-to-self.mjs):
 *     not playable — returns null, the player shows "unavailable".
 *
 * Every URL for a ready "self" row points at our S3 (s3.pub1.infomaniak.cloud,
 * CH): student browsers only talk to CH hosts.
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
  /** Out-of-band WebVTT tracks. */
  captions: VideoCaption[]
  /** WebVTT of sprite tiles for scrub previews (self-hosted only). */
  thumbnailsVtt?: string
}

type Meta = Record<string, unknown> | null | undefined

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

export function getVideoPlayback(provider: string | undefined, metadata: Meta): VideoPlayback | null {
  if (!metadata || provider !== 'self') return null
  const hlsUrl = str(metadata.hlsUrl)
  if (!hlsUrl || metadata.status !== 'ready') return null
  const aspectRatio = typeof metadata.aspectRatio === 'number' ? metadata.aspectRatio : undefined
  const captions = Array.isArray(metadata.captions)
    ? (metadata.captions as unknown[]).filter(
        (c): c is VideoCaption =>
          !!c && typeof c === 'object' && typeof (c as VideoCaption).src === 'string'
      )
    : []
  return {
    hlsUrl,
    poster: str(metadata.poster),
    aspectRatio,
    captions,
    thumbnailsVtt: str(metadata.thumbnailsVtt),
  }
}

/** True while the encoder still has to finish this row. */
export function isVideoPending(metadata: Meta): boolean {
  const status = metadata?.status
  return status === 'waiting' || status === 'queued' || status === 'encoding' || status === 'processing'
}
