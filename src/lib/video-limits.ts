/**
 * Upload limits for teacher videos. Checked in the browser before uploading
 * (resolution via a <video> element's loadedmetadata — nothing is uploaded
 * for that), on the server for the size (signed Content-Length), and again by
 * the encoder with ffprobe (scripts/video-worker/lib.mjs, which keeps its own
 * copy of these numbers; a test asserts they match).
 */

export const VIDEO_LIMITS = {
  maxLongSide: 1920,
  maxShortSide: 1080,
  maxBytes: 2 * 1024 ** 3,
  maxDurationSeconds: 2 * 3600,
} as const

/** null when within limits, else an English message. Orientation-independent. */
export function videoDimensionProblem(width: number, height: number): string | null {
  if (!width || !height) return null
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long > VIDEO_LIMITS.maxLongSide || short > VIDEO_LIMITS.maxShortSide) {
    return `This video is ${width}×${height}. Eduskript accepts videos up to 1080p (1920×1080). Please export it at 1080p or lower and upload it again.`
  }
  return null
}

export function videoSizeProblem(bytes: number): string | null {
  if (bytes > VIDEO_LIMITS.maxBytes) {
    return `This file is ${(bytes / 1024 ** 3).toFixed(1)} GB. The limit is 2 GB — please export a smaller file.`
  }
  return null
}

/**
 * Read width/height/duration from a local file without uploading it. Resolves
 * null when the browser can't decode the container/codec (e.g. HEVC in some
 * browsers) — the encoder re-validates in that case.
 */
export function readVideoMetadata(file: Blob, timeoutMs = 8000): Promise<{ width: number; height: number; duration: number } | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null)
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let done = false
    const finish = (value: { width: number; height: number; duration: number } | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () =>
      finish(video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight, duration: video.duration } : null)
    video.onerror = () => finish(null)
    video.src = url
  })
}

/** Size + resolution check before upload. Returns an English message or null. */
export async function checkVideoFile(file: Blob): Promise<string | null> {
  const size = videoSizeProblem(file.size)
  if (size) return size
  const meta = await readVideoMetadata(file)
  if (!meta) return null
  const dims = videoDimensionProblem(meta.width, meta.height)
  if (dims) return dims
  if (meta.duration > VIDEO_LIMITS.maxDurationSeconds) {
    return `This video is ${Math.round(meta.duration / 60)} minutes long. The limit is 2 hours.`
  }
  return null
}
