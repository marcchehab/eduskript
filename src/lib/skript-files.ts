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
  metadata: {
    playbackId?: string
    poster?: string
    blurDataURL?: string
    aspectRatio?: number
    assetId?: string
    status?: string
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

/** Resolve a file by name */
export function resolveFile(files: SkriptFilesData, filename: string): SkriptFile | undefined {
  return files.files[filename]
}

/** Resolve a file URL by name */
export function resolveUrl(files: SkriptFilesData, filename: string): string | undefined {
  return files.files[filename]?.url
}

/** Resolve Excalidraw light/dark SVG variants */
export function resolveExcalidraw(files: SkriptFilesData, filename: string): { lightUrl: string; darkUrl: string } | undefined {
  // Normalize filename - remove .excalidraw or .excalidraw.md extension
  const baseName = filename.replace(/\.excalidraw(\.md)?$/, '')

  // Look for light and dark SVG variants
  const lightFile = files.files[`${baseName}.excalidraw.light.svg`]
  const darkFile = files.files[`${baseName}.excalidraw.dark.svg`]

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
  return files.videos[filename]
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
