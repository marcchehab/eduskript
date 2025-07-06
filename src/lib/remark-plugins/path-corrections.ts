import type { Image, Root } from 'mdast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'
import { VFile } from 'vfile'

export interface PathCorrectionOptions {
  /** The domain/username for the current content */
  domain?: string
  /** The chapter ID for chapter-specific file searches */
  chapterId?: string
}

// Only import Node.js modules on the server side
let searchFileInSubdirectories: any, getChapterUploadDir: any, getGlobalUploadDir: any, filePathToUrl: any

if (typeof window === 'undefined') {
  // Server-side only imports
  const utils = require('./utils')
  searchFileInSubdirectories = utils.searchFileInSubdirectories
  getChapterUploadDir = utils.getChapterUploadDir
  getGlobalUploadDir = utils.getGlobalUploadDir
  filePathToUrl = utils.filePathToUrl
}

/**
 * Remark plugin to automatically find and correct image paths in EduGarden
 * 
 * For images with just filenames (e.g., ![alt](image.jpg) or ![[image.jpg]]):
 * 1. First searches in the chapter-specific upload directory
 * 2. Then searches in the global domain upload directory
 * 3. Converts found paths to web-accessible URLs
 * 
 * Leaves absolute paths and URLs unchanged.
 * Only works on server-side to avoid Node.js fs module issues in browser.
 */
export const remarkPathCorrections: Plugin<[PathCorrectionOptions?], Root, VFile> = (options = {}) =>
  (ast, file) => {
    const { domain, chapterId } = options

    visit(ast, 'image', (node: Image) => {
      // Skip if already an absolute URL or absolute path
      if (node.url.startsWith('http') || node.url.startsWith('/')) {
        return
      }

      // Skip if no filename (relative paths with directories)
      if (node.url.includes('/')) {
        return
      }

      // Client-side fallback: convert relative filenames to uploads path
      if (typeof window !== 'undefined') {
        if (domain && chapterId) {
          // Try chapter-specific path first
          node.url = `/uploads/${domain}/chapters/${chapterId}/${node.url}`
          return
        } else if (domain) {
          // Fallback to global domain path
          node.url = `/uploads/${domain}/global/${node.url}`
          return
        } else {
          // No domain info, leave as-is and warn
          console.warn('⚠️ remarkPathCorrections (client): No domain provided for', node.url)
          return
        }
      }

      // Server-side processing with file system search
      if (!domain) {
        console.warn('⚠️ remarkPathCorrections: No domain provided, cannot resolve image paths')
        return
      }

      let foundPath: string | null = null

      // First, search in chapter-specific directory if we have a chapter ID
      if (chapterId && getChapterUploadDir) {
        const chapterDir = getChapterUploadDir(domain, chapterId)
        foundPath = searchFileInSubdirectories(chapterDir, node.url)
      }

      // If not found in chapter directory, search in global domain directory
      if (!foundPath && getGlobalUploadDir) {
        const globalDir = getGlobalUploadDir(domain)
        foundPath = searchFileInSubdirectories(globalDir, node.url)
      }

      if (foundPath && filePathToUrl) {
        // Convert to web-accessible URL
        node.url = filePathToUrl(foundPath)
        console.log(`✅ Resolved image: ${node.url} -> ${foundPath}`)
      } else {
        console.warn(`⚠️ Could not find image file: ${node.url} in domain ${domain}${chapterId ? `, chapter ${chapterId}` : ''}`)
        // Fallback: try the most likely path
        if (chapterId) {
          node.url = `/uploads/${domain}/chapters/${chapterId}/${node.url}`
        } else {
          node.url = `/uploads/${domain}/global/${node.url}`
        }
      }
    })

    return ast
  }
