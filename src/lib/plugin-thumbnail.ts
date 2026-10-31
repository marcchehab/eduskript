/**
 * Plugin thumbnails. The image is a teacher file (public bucket, key
 * files/<sha256>.<ext>, see uploadTeacherFile in src/lib/s3.ts); the plugin
 * only keeps the key in manifest.thumbnailKey, so list responses stay small and
 * no migration was needed. Objects are content-addressed and may be shared by
 * forks, so removing a thumbnail clears the key and leaves the object in the
 * bucket (docs/internals/03-file-storage.md: orphans are not cleaned up).
 *
 * This file is imported by client components; the URL helper that needs the
 * bucket config is pluginThumbnailUrl in src/lib/services/plugins.ts.
 * scripts/apply-plugin-thumbnails.mjs writes the same key format.
 */

export const PLUGIN_THUMBNAIL = { width: 480, height: 300, maxBytes: 100_000 } as const

const KEY_RE = /^files\/[0-9a-f]{64}\.(webp|jpg)$/

export function pluginThumbnailKey(manifest: unknown): string | null {
  const key = (manifest as { thumbnailKey?: unknown } | null | undefined)?.thumbnailKey
  return typeof key === 'string' && KEY_RE.test(key) ? key : null
}

/**
 * The manifest as sent by a client (REST, MCP), without a thumbnail key: that
 * key is only written by the thumbnail route, which checks the image.
 */
export function withoutThumbnailKey(manifest: object): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...manifest }
  delete rest.thumbnailKey
  return rest
}

/**
 * Source rectangle that fills the target ratio, and the output size (never
 * enlarged). Keeps the top of tall screenshots, where plugins have their title
 * and controls, and centres wide ones.
 */
export function thumbnailCrop(srcWidth: number, srcHeight: number) {
  const { width: maxW, height: maxH } = PLUGIN_THUMBNAIL
  const ratio = maxW / maxH
  const sw = Math.min(srcWidth, srcHeight * ratio)
  const width = Math.max(1, Math.round(Math.min(maxW, sw)))
  return {
    sx: Math.round((srcWidth - sw) / 2),
    sy: 0,
    sw: Math.round(sw),
    sh: Math.round(sw / ratio),
    width,
    height: Math.max(1, Math.round(width / ratio)),
  }
}

/**
 * Browser only. Crops and downscales to WebP. Safari's canvas does not encode
 * WebP and returns PNG instead, so that case falls back to JPEG.
 */
export async function downscalePluginThumbnail(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image)
  const { sx, sy, sw, sh, width, height } = thumbnailCrop(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  // Transparent screenshots would turn black in JPEG.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
  bitmap.close()

  const encode = (type: string, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality)
    })
  for (const quality of [0.8, 0.6, 0.4]) {
    let blob = await encode('image/webp', quality)
    if (blob.type !== 'image/webp') blob = await encode('image/jpeg', quality)
    if (blob.size <= PLUGIN_THUMBNAIL.maxBytes) return blob
  }
  throw new Error('This image is too detailed for a thumbnail')
}
