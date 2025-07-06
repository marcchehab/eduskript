import fs from 'fs'
import path from 'path'

/**
 * Recursively search for a file by name in a directory and its subdirectories
 * @param searchDir The directory to search in
 * @param fileName The name of the file to find
 * @returns The full path to the file if found, null otherwise
 */
export function searchFileInSubdirectories(searchDir: string, fileName: string): string | null {
  try {
    if (!fs.existsSync(searchDir)) {
      return null
    }

    const items = fs.readdirSync(searchDir, { withFileTypes: true })
    
    // First, check if the file exists directly in this directory
    for (const item of items) {
      if (item.isFile() && item.name === fileName) {
        return path.join(searchDir, item.name)
      }
    }
    
    // Then, recursively search subdirectories
    for (const item of items) {
      if (item.isDirectory()) {
        const found = searchFileInSubdirectories(path.join(searchDir, item.name), fileName)
        if (found) {
          return found
        }
      }
    }
    
    return null
  } catch (error) {
    console.warn(`Error searching for file ${fileName} in ${searchDir}:`, error)
    return null
  }
}

/**
 * Get the chapter-specific upload directory for a given domain and chapter ID
 * @param domain The domain/username
 * @param chapterId The chapter ID
 * @returns The path to the chapter's upload directory
 */
export function getChapterUploadDir(domain: string, chapterId: string): string {
  return path.join(process.cwd(), 'public', 'uploads', domain, 'chapters', chapterId)
}

/**
 * Get the global upload directory for a domain
 * @param domain The domain/username
 * @returns The path to the domain's global upload directory
 */
export function getGlobalUploadDir(domain: string): string {
  return path.join(process.cwd(), 'public', 'uploads', domain)
}

/**
 * Convert an absolute file path to a web-accessible URL path
 * @param filePath The absolute file path
 * @returns The web-accessible URL path starting with /uploads/
 */
export function filePathToUrl(filePath: string): string {
  const publicDir = path.join(process.cwd(), 'public')
  const relativePath = path.relative(publicDir, filePath)
  return '/' + relativePath.replace(/\\/g, '/') // Ensure forward slashes for URLs
}
