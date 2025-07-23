import { visit } from 'unist-util-visit'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { promisify } from 'util'

const mkdir = promisify(fs.mkdir)
const access = promisify(fs.access)

interface ServerImageOptimizerOptions {
  domain?: string
  chapterId?: string
  fileList?: Array<{filename: string, url: string, relativePath: string}>
}

/**
 * Server-side remark plugin that downloads S3 images locally for Next.js optimization
 * Only runs in Node.js environment, skips in browser
 */
export function remarkServerImageOptimizer(options: ServerImageOptimizerOptions = {}) {
  return async function transformer(tree: unknown) {
    // Skip if running in browser (client-side)
    if (typeof window !== 'undefined') {
      return
    }

    const { domain, chapterId, fileList } = options
    
    if (!domain || !chapterId) return

    const downloadPromises: Promise<void>[] = []

    // Visit all image nodes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree as Parameters<typeof visit>[0], 'image', (node: any) => {
      if (!node.url || typeof node.url !== 'string') return

      // Skip if already a full URL or absolute path
      if (node.url.startsWith('http') || node.url.startsWith('https') || node.url.startsWith('/')) {
        return
      }

      // Find the file in the file list
      const fileInfo = fileList?.find(file => file.filename === node.url)
      if (!fileInfo) return

      // Create local cache path
      const cacheDir = path.join(process.cwd(), 'public', 'cache', 'images', domain, chapterId)
      const localPath = path.join(cacheDir, fileInfo.filename)
      const publicPath = `/cache/images/${domain}/${chapterId}/${fileInfo.filename}`

      // Download and cache the image
      const downloadPromise = downloadImage(fileInfo.url, localPath, cacheDir)
        .then(() => {
          // Update the node to use the local cached image
          node.url = publicPath
        })
        .catch(error => {
          console.error(`Failed to download image ${fileInfo.url}:`, error)
          // Keep original URL as fallback
        })

      downloadPromises.push(downloadPromise)
    })

    // Wait for all downloads to complete
    await Promise.all(downloadPromises)
  }
}

async function downloadImage(url: string, localPath: string, cacheDir: string): Promise<void> {
  // Check if image already exists
  try {
    await access(localPath)
    return // File already exists, skip download
  } catch {
    // File doesn't exist, proceed with download
  }

  // Ensure cache directory exists
  await mkdir(cacheDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(localPath)
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
        return
      }

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        resolve()
      })

      file.on('error', (err) => {
        fs.unlink(localPath, () => {}) // Clean up partial file
        reject(err)
      })
    }).on('error', reject)
  })
} 