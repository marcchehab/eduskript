'use client'

/**
 * Browser side of a video upload (dashboard modal + zip import):
 *   1. requestVideoUpload → row + presigned S3 PUT (/api/videos/upload-url)
 *   2. caller PUTs the bytes with `uploadHeaders`
 *   3. finishVideoUpload → server hands the object to Infomaniak VOD
 *      (/api/videos/[id]/uploaded). Processing continues server-side; the
 *      video browser polls /api/videos/sync until the row is ready.
 */

export interface VideoUploadTicket {
  uploadUrl: string
  videoId: string
  uploadHeaders: Record<string, string>
}

export async function requestVideoUpload(
  filename: string,
  skriptId: string | undefined,
  contentType: string | undefined
): Promise<VideoUploadTicket> {
  const res = await fetch('/api/videos/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, skriptId, contentType: contentType || 'video/mp4' }),
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
