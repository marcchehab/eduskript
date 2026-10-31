/**
 * SkriptFiles - Unified file resolution for both SSR and CSR.
 *
 * This is a SERIALIZABLE data structure (no Maps, no methods) that can be
 * passed from Server Components to Client Components.
 *
 * Use the utility functions (resolveFile, resolveUrl, etc.) to look up files.
 *
 * NOTE: Server-only functions (getSkriptFiles) are in skript-files.server.ts
 * to avoid pulling in Prisma dependencies in client bundles.
 */

import { decodeFileRef, normalizeFileName } from './file-refs'

// Types for file resolution
export interface SkriptFile {
  id: string
  name: string
  url: string     // Direct S3 URL (public bucket)
  updatedAt?: string | Date  // For cache busting
  width?: number  // Image width in pixels
  height?: number // Image height in pixels
}

export interface VideoInfo {
  id: string
  filename: string
  provider: string
  /** Subset of Video.metadata; full shapes in src/lib/video-playback.ts. */
  metadata: {
    poster?: string
    blurDataURL?: string
    aspectRatio?: number
    status?: string
    hlsUrl?: string
    captions?: Array<{ src: string; lang: string; label: string }>
    thumbnailsVtt?: string
    progress?: number
    error?: string
  }
}

/** Pick the VideoInfo fields out of a Video.metadata JSON value. */
export function toVideoInfoMetadata(raw: unknown, defaultStatus?: string): VideoInfo['metadata'] {
  const m = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return {
    poster: str(m.poster),
    blurDataURL: str(m.blurDataURL),
    aspectRatio: typeof m.aspectRatio === 'number' ? m.aspectRatio : undefined,
    status: str(m.status) ?? defaultStatus,
    hlsUrl: str(m.hlsUrl),
    captions: Array.isArray(m.captions) ? (m.captions as NonNullable<VideoInfo['metadata']['captions']>) : undefined,
    thumbnailsVtt: str(m.thumbnailsVtt),
    progress: typeof m.progress === 'number' ? m.progress : undefined,
    error: str(m.error),
  }
}

/**
 * Serializable data structure for file resolution.
 * Uses Record<string, T> instead of Map for JSON serialization.
 */
export interface SkriptFilesData {
  env: 'ssr' | 'csr'
  files: Record<string, SkriptFile>
  videos: Record<string, VideoInfo>
}

// ============================================================================
// Utility Functions (use these to look up files)
// ============================================================================

/**
 * Look a reference up: the exact name, then percent-decoded (see file-refs.ts),
 * then compared after NFC and whitespace normalization.
 *
 * The last step is a linear scan, O(n) per unmatched reference. It only runs
 * when the first two miss, and it needs no index in SkriptFilesData, whose
 * cached server payloads (unstable_cache) predate any new field.
 *
 * Exact first keeps a raw `![](50%25.png)` on the file of that literal name. The
 * cost is the limitation in file-refs.ts: the same order sends the embed of
 * "a b.png" to a sibling literally named "a%20b.png". Decoding first would
 * instead break stored raw embeds of such literal names.
 */
function lookup<T>(record: Record<string, T>, ref: string): T | undefined {
  if (record[ref]) return record[ref]
  const decoded = decodeFileRef(ref)
  if (record[decoded]) return record[decoded]
  const wanted = normalizeFileName(decoded)
  for (const name of Object.keys(record)) {
    if (normalizeFileName(name) === wanted) return record[name]
  }
  return undefined
}

/** Resolve a file by name or stored reference */
export function resolveFile(files: SkriptFilesData, filename: string): SkriptFile | undefined {
  return lookup(files.files, filename)
}

/** Resolve a file URL by name or stored reference */
export function resolveUrl(files: SkriptFilesData, filename: string): string | undefined {
  return resolveFile(files, filename)?.url
}

/** Every stored name, for repairFileRefs via compileMarkdown's `fileNames`. */
export function skriptFileNames(files: SkriptFilesData): string[] {
  return [...Object.keys(files.files), ...Object.keys(files.videos)]
}

/** Resolve Excalidraw light/dark SVG variants */
export function resolveExcalidraw(files: SkriptFilesData, filename: string): { lightUrl: string; darkUrl: string } | undefined {
  // Normalize filename - remove .excalidraw or .excalidraw.md extension
  const baseName = filename.replace(/\.excalidraw(\.md)?$/i, '')

  // Look for light and dark SVG variants
  const lightFile = resolveFile(files, `${baseName}.excalidraw.light.svg`)
  const darkFile = resolveFile(files, `${baseName}.excalidraw.dark.svg`)

  if (lightFile && darkFile) {
    // Cache-busting parameter based on updatedAt to ensure fresh content after re-export
    const addCacheBust = (file: SkriptFile) => {
      if (!file.updatedAt) return file.url
      const separator = file.url.includes('?') ? '&' : '?'
      return `${file.url}${separator}v=${new Date(file.updatedAt).getTime()}`
    }
    return {
      lightUrl: addCacheBust(lightFile),
      darkUrl: addCacheBust(darkFile),
    }
  }

  return undefined
}

/** Resolve video metadata by filename */
export function resolveVideo(files: SkriptFilesData, filename: string): VideoInfo | undefined {
  return lookup(files.videos, filename)
}

// ============================================================================
// Factory Functions (create SkriptFilesData from various sources)
// ============================================================================

// NOTE: getSkriptFiles() is in skript-files.server.ts (requires Prisma, server-only)

/**
 * CSR: Create SkriptFilesData from pre-fetched arrays.
 * Used in the dashboard live preview where we have the file list from the browser.
 */
export function createSkriptFiles(
  fileList: Array<{ id: string; name: string; url?: string; updatedAt?: string | Date; width?: number; height?: number }>,
  videoList?: VideoInfo[]
): SkriptFilesData {
  // Build files record
  const files: Record<string, SkriptFile> = {}
  for (const file of fileList) {
    if (!file.name) continue
    files[file.name] = {
      id: file.id,
      name: file.name,
      url: file.url || `/api/files/${file.id}`,
      updatedAt: file.updatedAt,
      width: file.width,
      height: file.height,
    }
  }

  // Build videos record
  const videos: Record<string, VideoInfo> = {}
  if (videoList) {
    for (const video of videoList) {
      videos[video.filename] = video
    }
  }

  return { env: 'csr', files, videos }
}

/**
 * Create an empty SkriptFilesData (for when no skript context is available)
 */
export function createEmptySkriptFiles(): SkriptFilesData {
  return { env: 'csr', files: {}, videos: {} }
}
