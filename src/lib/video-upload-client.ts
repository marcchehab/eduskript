'use client'

/**
 * Browser side of a video upload (dashboard modal + zip import):
 *   1. requestVideoUpload → row + presigned S3 PUT (/api/videos/upload-url)
 *   2. caller PUTs the bytes with `uploadHeaders`
 *   3. finishVideoUpload → server queues the encode (/api/videos/[id]/uploaded).
 *      The encoder (scripts/video-worker.mjs) writes progress/status into the
 *      row; the video browser re-fetches the list while it is pending.
 * Limits are checked before step 1 (checkVideoFile, src/lib/video-limits.ts).
 */

export interface VideoUploadTicket {
  uploadUrl: string
  videoId: string
  uploadHeaders: Record<string, string>
}

export async function requestVideoUpload(
  filename: string,
  skriptId: string | undefined,
  contentType: string | undefined,
  size: number
): Promise<VideoUploadTicket> {
  const res = await fetch('/api/videos/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, skriptId, contentType: contentType || 'video/mp4', size }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not get a video upload URL (${res.status})`)
  return { uploadUrl: data.uploadUrl, videoId: data.videoId, uploadHeaders: data.uploadHeaders ?? {} }
}

export async function finishVideoUpload(videoId: string): Promise<void> {
  const res = await fetch(`/api/videos/${videoId}/uploaded`, { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Could not start video processing (${res.status})`)
  }
}
