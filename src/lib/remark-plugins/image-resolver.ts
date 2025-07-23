import { visit } from 'unist-util-visit'
import path from 'path'

interface ImageNode {
  type: 'image'
  url: string
}

interface FileInfo {
  filename: string
  url: string
  relativePath: string
}

interface ImageResolverOptions {
  domain?: string
  chapterId?: string
  isClient?: boolean
  fileList?: FileInfo[] // Pre-fetched file list for client-side resolution
}

/**
 * Remark plugin to resolve image paths using file list or filesystem
 * Professional solution that works on both client and server
 */
export function remarkImageResolver(options: ImageResolverOptions = {}) {
  return function transformer(tree: unknown) {
    const { domain, chapterId, isClient = false, fileList } = options

    console.log('🔍 Image resolver running:', { 
      domain, 
      chapterId, 
      isClient, 
      hasFileList: !!fileList,
      fileCount: fileList?.length || 0,
      hasWindow: typeof window !== 'undefined' 
    })

    // Resolve image paths
    visit(tree as Parameters<typeof visit>[0], 'image', (node: ImageNode) => {
      const { url } = node
      console.log('📸 Processing image:', url)

      // Skip if already a full URL or absolute path
      if (url.startsWith('http') || url.startsWith('https') || url.startsWith('/')) {
        console.log('⏩ Skipping absolute URL:', url)
        return
      }

      let resolvedPath: string | null = null

      // Try client-side resolution first (using file list)
      if (fileList && fileList.length > 0) {
        resolvedPath = resolveFromFileList(url, fileList)
        console.log('📋 File list resolution for', url, ':', resolvedPath)
      }

      // Fallback to server-side resolution if no file list or not found
      // Allow filesystem fallback when running server-side, regardless of isClient flag
      if (!resolvedPath && typeof window === 'undefined') {
        console.log('🖥️ Falling back to server-side resolution')
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { searchFileInSubdirectories, getChapterUploadDir, getGlobalUploadDir, filePathToUrl } = require('./utils')
          resolvedPath = resolveFromFilesystem(url, domain, chapterId, { searchFileInSubdirectories, getChapterUploadDir, getGlobalUploadDir, filePathToUrl })
          console.log('💾 Filesystem resolution for', url, ':', resolvedPath)
        } catch (error) {
          console.error('❌ Error in filesystem resolution:', error)
        }
      }

      // Apply resolved path
      if (resolvedPath) {
        console.log('✅ Resolved', url, '→', resolvedPath)
        node.url = resolvedPath
      } else {
        console.warn(`⚠️ Image not found: ${url}`)
        // Keep the original URL - it might work as a relative path
      }
    })
  }
}

/**
 * Resolve image path from pre-fetched file list (client-side)
 */
function resolveFromFileList(filename: string, fileList: FileInfo[]): string | null {
  // Direct filename match
  const directMatch = fileList.find(file => file.filename === filename)
  if (directMatch) {
    return directMatch.url
  }

  // Try to find by basename (in case of path variations)
  const basename = path.basename(filename)
  const basenameMatch = fileList.find(file => path.basename(file.filename) === basename)
  if (basenameMatch) {
    return basenameMatch.url
  }

  return null
}

/**
 * Resolve image path using filesystem operations (server-side)
 */
function resolveFromFilesystem(
  filename: string, 
  domain?: string, 
  chapterId?: string,
  utils?: {
    searchFileInSubdirectories: (dir: string, filename: string) => string | null
    getChapterUploadDir: (domain: string, chapterId: string) => string
    getGlobalUploadDir: (domain: string) => string
    filePathToUrl: (path: string) => string
  }
): string | null {
  if (!domain || !utils) {
    return null
  }

  const { searchFileInSubdirectories, getChapterUploadDir, getGlobalUploadDir, filePathToUrl } = utils

  // Search in chapter-specific directory first (if chapter is specified)
  if (chapterId) {
    const chapterDir = getChapterUploadDir(domain, chapterId)
    const foundInChapter = searchFileInSubdirectories(chapterDir, filename)
    if (foundInChapter) {
      return filePathToUrl(foundInChapter)
    }
  }

  // Search in global upload directory
  const globalDir = getGlobalUploadDir(domain)
  const foundInGlobal = searchFileInSubdirectories(globalDir, filename)
  if (foundInGlobal) {
    return filePathToUrl(foundInGlobal)
  }

  return null
}
