/**
 * File Storage System
 *
 * Content-addressed storage with automatic deduplication. Files are stored
 * in S3 using their SHA256 hash as the key, so identical files share storage.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ Database (Prisma)                                                   │
 * │ ┌──────────────────────────┐  ┌──────────────────────────────────┐ │
 * │ │ File                     │  │ File (same content)              │ │
 * │ │ - id: "file-1"           │  │ - id: "file-2"                   │ │
 * │ │ - name: "image.png"      │  │ - name: "copy.png"               │ │
 * │ │ - hash: "abc123..."      │──│ - hash: "abc123..." (same!)      │ │
 * │ │ - skriptId: "skript-A"   │  │ - skriptId: "skript-B"           │ │
 * │ └──────────────────────────┘  └──────────────────────────────────┘ │
 * │              │                              │                       │
 * │              └──────────┬───────────────────┘                       │
 * │                         ▼                                           │
 * │              ┌──────────────────────┐                               │
 * │              │ S3: files/abc123.png │ ← Single copy in storage      │
 * │              └──────────────────────┘                               │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Key Behaviors
 *
 * 1. **Deduplication**: Before uploading, we check if the hash already exists
 *    in S3. If it does, we create the database record without uploading.
 *
 * 2. **Reference Counting**: Files are only deleted from S3 when no database
 *    records reference their hash anymore.
 *
 * 3. **Hierarchical Structure**: Files can be organized in directories within
 *    a skript. Directories are File records with `isDirectory: true`.
 *
 * 4. **Public Access**: Files in published skripts are publicly accessible
 *    via presigned URLs. Unpublished skripts require authentication.
 *
 * ## Security
 *
 * - Filenames are sanitized to prevent path traversal attacks
 * - File types are validated against an allowlist
 * - Size limits prevent denial-of-service via large uploads
 * - Hash-based keys make URLs unguessable
 *
 * ## Known Limitations
 *
 * 1. **Extension-based validation only**: We validate file type by extension,
 *    not by inspecting file contents (magic bytes). A malicious user could
 *    upload a .png that's actually a .exe. This is mitigated by the fact
 *    that files are served with correct Content-Type headers.
 *
 * 2. **No virus scanning**: Uploaded files are not scanned for malware.
 *    For high-security deployments, consider adding ClamAV integration.
 *
 * 3. **Orphaned S3 files**: If a database transaction fails after S3 upload,
 *    the S3 file becomes orphaned. A cleanup job would help but isn't implemented.
 *
 * 4. **No rate limiting**: File uploads aren't rate-limited at this layer.
 *    The API route should implement rate limiting to prevent abuse.
 *
 * @see src/app/api/upload/route.ts for the upload endpoint
 * @see src/app/api/files/[id]/route.ts for file serving
 */

import * as crypto from 'crypto'
import { prisma } from './prisma'
import {
  isTeacherS3Configured,
  uploadTeacherFile,
  deleteTeacherFile,
  getTeacherFileUrl,
  teacherFileExists,
} from './s3'
import { invalidateSkriptFiles } from './skript-files.server'

// File storage configuration - exported for pre-validation in upload handlers
// 500MB default for direct S3 uploads (large videos/databases)
// Server-proxied uploads are limited by platform body size limits (~10MB)
export const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '524288000') // 500MB default
export const ALLOWED_TYPES = (process.env.ALLOWED_FILE_TYPES || 'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,odt,txt,md,zip,mp4,mp3,wav,ogg,webm,csv,json,xml,html,css,js,ts,py,java,cpp,c,h,hpp,rs,go,php,rb,sh,yml,yaml,excalidraw,db,sqlite,ig').split(',')

/**
 * Characters that are dangerous in filenames (path traversal, null bytes, control chars).
 * Used to sanitize uploaded filenames before storage.
 */
const DANGEROUS_FILENAME_PATTERN = /[<>:"/\\|?*\x00-\x1f]|\.\.|\.\//g

/**
 * Sanitize a filename by removing dangerous characters.
 * Prevents path traversal attacks and filesystem issues.
 */
export function sanitizeFilename(filename: string): string {
  // Remove path traversal sequences and dangerous characters
  let sanitized = filename.replace(DANGEROUS_FILENAME_PATTERN, '')

  // Remove leading/trailing dots and spaces (Windows issues)
  sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '')

  // Ensure we have a valid filename
  if (!sanitized || sanitized.length === 0) {
    return 'unnamed_file'
  }

  // Truncate if too long (keep extension if possible)
  if (sanitized.length > 255) {
    const ext = getFileExtension(sanitized)
    const maxBase = 255 - (ext ? ext.length + 1 : 0)
    const base = sanitized.substring(0, sanitized.lastIndexOf('.') || sanitized.length)
    sanitized = base.substring(0, maxBase) + (ext ? `.${ext}` : '')
  }

  return sanitized
}

/**
 * Calculate SHA256 hash for file content (using built-in crypto for simplicity)
 */
export async function calculateFileHash(buffer: Buffer): Promise<string> {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string | null {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === filename.length - 1) return null
  return filename.substring(lastDot + 1).toLowerCase()
}

/**
 * Get the S3 key for a file based on its hash and extension
 */
export function getS3Key(hash: string, extension: string): string {
  return `files/${hash}.${extension}`
}

/**
 * Validate file type and size
 */
export function validateFile(filename: string, size: number): { valid: boolean; error?: string } {
  // Check file size
  if (size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1048576}MB`
    }
  }

  // Check file type
  const extension = getFileExtension(filename)
  if (!extension || !ALLOWED_TYPES.includes(extension)) {
    return {
      valid: false,
      error: `File type '${extension || 'unknown'}' not allowed. Allowed types: ${ALLOWED_TYPES.join(', ')}`
    }
  }

  return { valid: true }
}

/**
 * Save file to S3 and database.
 *
 * PERFORMANCE NOTE: We compute the SHA256 hash for every upload, even if a
 * file with the same name already exists. A potential optimization would be
 * to check for name conflicts before hashing, but this would require changing
 * the overwrite logic. Current approach prioritizes correctness over speed.
 *
 * The hash computation is ~100-500ms for a 10MB file, which is acceptable
 * for user-initiated uploads but could be optimized for batch imports.
 */
export async function saveFile({
  buffer,
  filename,
  skriptId,
  userId,
  parentId = null,
  contentType,
  overwrite = false,
  width,
  height,
}: {
  buffer: Buffer
  filename: string
  skriptId: string
  userId: string
  parentId?: string | null
  contentType?: string
  overwrite?: boolean
  width?: number
  height?: number
}): Promise<{ id: string; hash: string; url: string; size: number }> {
  // Check S3 configuration
  if (!isTeacherS3Configured()) {
    throw new Error('File storage not configured. Set SCW_TEACHER_BUCKET environment variable.')
  }

  // Validate file
  const validation = validateFile(filename, buffer.length)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  // Check if file with same name already exists in the same parent/skript
  const existingFile = await prisma.file.findFirst({
    where: {
      name: filename,
      parentId,
      skriptId,
      isDirectory: false
    }
  })

  if (existingFile && !overwrite) {
    throw new Error('File already exists. Use overwrite option or rename the file.')
  }

  // Calculate hash for content-addressed storage
  const hash = await calculateFileHash(buffer)
  const extension = getFileExtension(filename)!
  const mimeType = contentType || getMimeType(extension)

  // Check if file already exists in S3 (deduplication)
  const fileExistsInS3 = await teacherFileExists(hash, extension)

  // Upload to S3 if it doesn't exist (deduplication)
  if (!fileExistsInS3) {
    await uploadTeacherFile(hash, extension, buffer, mimeType, filename)
  }

  // Create or update database record
  let file
  if (existingFile && overwrite) {
    // Check if hash has changed - if not, just update metadata
    const hashChanged = existingFile.hash !== hash

    // Update existing file
    file = await prisma.file.update({
      where: { id: existingFile.id },
      data: {
        // Only update hash if it has changed (to avoid unique constraint violation)
        ...(hashChanged && { hash }),
        contentType: mimeType,
        size: BigInt(buffer.length),
        width: width ?? null,
        height: height ?? null,
        updatedAt: new Date()
      }
    })
  } else {
    // Create new file record
    file = await prisma.file.create({
      data: {
        name: filename,
        parentId,
        skriptId,
        hash,
        contentType: mimeType,
        size: BigInt(buffer.length),
        width: width ?? null,
        height: height ?? null,
        createdBy: userId,
        isDirectory: false
      }
    })
  }

  // Markdown renders read the file list through getSkriptFiles, which caches
  // until this tag is dropped.
  invalidateSkriptFiles(skriptId)

  return {
    id: file.id,
    hash,
    url: getTeacherFileUrl(getS3Key(hash, extension)),
    size: buffer.length
  }
}

/**
 * Get MIME type from file extension
 */
export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'zip': 'application/zip',
    'mp4': 'video/mp4',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'webm': 'video/webm',
    'csv': 'text/csv',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'py': 'text/x-python',
    'java': 'text/x-java',
    'cpp': 'text/x-c++src',
    'c': 'text/x-csrc',
    'h': 'text/x-chdr',
    'hpp': 'text/x-c++hdr',
    'rs': 'text/x-rustsrc',
    'go': 'text/x-go',
    'php': 'text/x-php',
    'rb': 'text/x-ruby',
    'sh': 'application/x-sh',
    'yml': 'text/yaml',
    'yaml': 'text/yaml',
    'excalidraw': 'application/json',
    'db': 'application/x-sqlite3',
    'sqlite': 'application/x-sqlite3',
  }
  return mimeTypes[extension] || 'application/octet-stream'
}

/**
 * Create directory in database
 */
export async function createDirectory({
  name,
  skriptId,
  userId,
  parentId = null
}: {
  name: string
  skriptId: string
  userId: string
  parentId?: string | null
}): Promise<{ id: string }> {
  // Check if directory with same name already exists
  const existingDir = await prisma.file.findFirst({
    where: {
      name,
      parentId,
      skriptId,
      isDirectory: true
    }
  })

  if (existingDir) {
    throw new Error('Directory already exists')
  }

  const directory = await prisma.file.create({
    data: {
      name,
      parentId,
      skriptId,
      createdBy: userId,
      isDirectory: true
    }
  })

  invalidateSkriptFiles(skriptId)

  return { id: directory.id }
}

/**
 * Delete file or directory
 */
export async function deleteFile(fileId: string, userId: string): Promise<void> {
  // Get file info
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    include: {
      skript: {
        include: {
          authors: true
        }
      }
    }
  })

  if (!file) {
    throw new Error('File not found')
  }

  // Check permissions - user must be skript author
  const hasPermission = file.skript.authors.some(author => author.userId === userId)
  if (!hasPermission) {
    throw new Error('Permission denied')
  }

  if (file.isDirectory) {
    // For directories, delete all children recursively
    const children = await prisma.file.findMany({
      where: { parentId: fileId }
    })

    for (const child of children) {
      await deleteFile(child.id, userId)
    }
  } else {
    // For files, check if other files use the same hash
    const filesWithSameHash = await prisma.file.count({
      where: {
        hash: file.hash!,
        id: { not: fileId }
      }
    })

    // Only delete from S3 if no other records reference it
    if (filesWithSameHash === 0 && file.hash) {
      const extension = getFileExtension(file.name)!
      const s3Key = getS3Key(file.hash, extension)
      try {
        await deleteTeacherFile(s3Key)
      } catch {
        // Don't throw - database cleanup is more important
      }
    }

    // If this is an Excalidraw file, also delete associated SVG variants
    if (file.name.endsWith('.excalidraw')) {
      const lightSvgName = `${file.name}.light.svg`
      const darkSvgName = `${file.name}.dark.svg`

      const svgFiles = await prisma.file.findMany({
        where: {
          skriptId: file.skriptId,
          parentId: file.parentId,
          name: { in: [lightSvgName, darkSvgName] }
        }
      })

      for (const svgFile of svgFiles) {
        // Recursively delete each SVG (handles S3 cleanup and deduplication)
        try {
          await deleteFile(svgFile.id, userId)
        } catch {
          // Continue even if SVG deletion fails
        }
      }
    }
  }

  // Delete database record
  await prisma.file.delete({
    where: { id: fileId }
  })

  invalidateSkriptFiles(file.skriptId)
}

/**
 * List files in a directory
 */
export async function listFiles({
  skriptId,
  parentId = null,
  userId
}: {
  skriptId: string
  parentId?: string | null
  userId: string
}): Promise<Array<{
  id: string
  name: string
  isDirectory: boolean
  size?: number
  contentType?: string
  createdAt: Date
  updatedAt: Date
  url?: string
}>> {
  // Check permissions - user must be skript author
  const skript = await prisma.skript.findFirst({
    where: {
      id: skriptId,
      authors: {
        some: { userId }
      }
    }
  })

  if (!skript) {
    throw new Error('Skript not found or permission denied')
  }

  const files = await prisma.file.findMany({
    where: {
      skriptId,
      parentId
    },
    orderBy: [
      { isDirectory: 'desc' }, // Directories first
      { name: 'asc' }          // Then alphabetical
    ]
  })

  return files.map(file => {
    let url: string | undefined
    if (!file.isDirectory && file.hash) {
      const ext = getFileExtension(file.name)
      if (ext) url = getTeacherFileUrl(getS3Key(file.hash, ext))
    }
    return {
      id: file.id,
      name: file.name,
      isDirectory: file.isDirectory,
      size: file.size ? Number(file.size) : undefined,
      contentType: file.contentType || undefined,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      url,
    }
  })
}

/**
 * List all files recursively for a skript (includes files in subdirectories)
 */
export async function listAllFiles({
  skriptId,
  userId
}: {
  skriptId: string
  userId: string
}): Promise<Array<{
  id: string
  name: string
  isDirectory: boolean
  size?: number
  contentType?: string
  createdAt: Date
  updatedAt: Date
  url?: string
}>> {
  // Check permissions - user must be skript author
  const skript = await prisma.skript.findFirst({
    where: {
      id: skriptId,
      authors: {
        some: { userId }
      }
    }
  })

  if (!skript) {
    throw new Error('Skript not found or permission denied')
  }

  // Get ALL files for this skript (not filtered by parentId)
  const files = await prisma.file.findMany({
    where: {
      skriptId
    },
    orderBy: [
      { isDirectory: 'desc' }, // Directories first
      { name: 'asc' }          // Then alphabetical
    ]
  })

  return files.map(file => {
    let url: string | undefined
    if (!file.isDirectory && file.hash) {
      const ext = getFileExtension(file.name)
      if (ext) url = getTeacherFileUrl(getS3Key(file.hash, ext))
    }
    return {
      id: file.id,
      name: file.name,
      isDirectory: file.isDirectory,
      size: file.size ? Number(file.size) : undefined,
      contentType: file.contentType || undefined,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      url,
    }
  })
}

/**
 * Get file by ID with permission check
 */
export async function getFileById(fileId: string, userId?: string): Promise<{
  id: string
  name: string
  hash?: string
  contentType?: string
  size?: number
  s3Key?: string
  s3Url?: string
  skriptId: string
  parentId: string | null
} | null> {
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    include: {
      skript: {
        include: {
          authors: true,
          pages: {
            select: {
              isPublished: true
            }
          },
          // Include FrontPages that use this skript for file storage
          frontPageFileStorage: {
            select: {
              isPublished: true
            }
          }
        }
      }
    }
  })

  if (!file) {
    return null
  }

  // Check permissions
  // Allow access if:
  // 1. User is an author of the skript
  // 2. File belongs to a skript with at least one published page (public access)
  // 3. File belongs to a skript used as file storage for a published FrontPage
  const hasAuthorPermission = userId && file.skript.authors.some(author => author.userId === userId)
  const hasPublishedPage = file.skript.pages.some(page => page.isPublished)
  const hasPublishedFrontPage = file.skript.frontPageFileStorage?.isPublished ?? false
  const hasPublicAccess = hasPublishedPage || hasPublishedFrontPage

  if (!hasAuthorPermission && !hasPublicAccess) {
    throw new Error('Permission denied')
  }

  if (file.isDirectory) {
    return {
      id: file.id,
      name: file.name,
      skriptId: file.skriptId,
      parentId: file.parentId
    }
  }

  const extension = getFileExtension(file.name)!
  const s3Key = getS3Key(file.hash!, extension)
  const s3Url = getTeacherFileUrl(s3Key)

  return {
    id: file.id,
    name: file.name,
    hash: file.hash!,
    contentType: file.contentType || undefined,
    size: file.size ? Number(file.size) : undefined,
    s3Key,
    s3Url,
    skriptId: file.skriptId,
    parentId: file.parentId
  }
}