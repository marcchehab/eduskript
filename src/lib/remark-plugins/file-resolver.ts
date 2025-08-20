import { visit } from 'unist-util-visit'
import path from 'path'

interface FileInfo {
  id: string
  name: string
  url?: string
  isDirectory?: boolean
}

interface FileResolverOptions {
  fileList?: FileInfo[] // Pre-fetched file list for client-side resolution
}

/**
 * Remark plugin to resolve all embedded file paths (images, pdfs, audio, video, etc.)
 * using a provided file list (from local file API).
 * Replaces any non-absolute file reference with the correct file URL.
 */
export function remarkFileResolver(options: FileResolverOptions = {}) {
  return function transformer(tree: unknown) {
    const { fileList } = options

    // Visit all nodes that can embed files (image, link, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree as Parameters<typeof visit>[0], (node: any) => {
      // Only process nodes with a 'url' property (image, link, etc.)
      if (!node.url || typeof node.url !== 'string') return

      const url = node.url

      // Skip if already a full URL or absolute path
      if (url.startsWith('http') || url.startsWith('https') || url.startsWith('/')) {
        return
      }

      let resolvedPath: string | null = null

      // Try client-side resolution first (using file list)
      if (fileList && fileList.length > 0) {
        resolvedPath = resolveFromFileList(url, fileList)
      }

      // Apply resolved path if found
      if (resolvedPath) {
        node.url = resolvedPath
      } else {
        // IMPORTANT: Convert to absolute path to prevent relative URL interpretation
        // This prevents server 404s by making it clear this is not a relative URL
        node.url = `/missing-file/${url}`
      }
    })
  }
}

/**
 * Resolve file path from pre-fetched file list (client-side)
 */
function resolveFromFileList(filename: string, fileList: FileInfo[]): string | null {
  
  // Direct filename match
  for (const file of fileList) {
    if (!file.isDirectory && filename === file.name) {
      return file.url || `/api/files/${file.id}`
    }
  }

  // Try to find by basename (in case of path variations)
  const basename = path.basename(filename)
  const basenameMatch = fileList.find(file => !file.isDirectory && path.basename(file.name) === basename)
  if (basenameMatch) {
    return basenameMatch.url || `/api/files/${basenameMatch.id}`
  }

  return null
}
