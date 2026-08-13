'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidatePath, revalidateTag } from 'next/cache'
import { CACHE_TAGS } from '@/lib/cached-queries'
import JSZip from 'jszip'
import { isTeacherS3Configured } from '@/lib/s3'
import { saveFile } from '@/lib/file-storage'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

interface ExportManifest {
  version: number
  exportedAt: string
  collections: {
    title: string
    description: string | null
    skripts: string[] // skript slugs in this collection
  }[]
  skripts: {
    [slug: string]: {
      title: string
      description: string | null
      pages: string[]
    }
  }
}

interface ImportError {
  type: 'error' | 'warning'
  location: string
  message: string
}

interface ImportPreview {
  collections: { title: string; isNew: boolean }[]
  skripts: { slug: string; title: string; pageCount: number; isNew: boolean }[]
  attachments: number
  errors: ImportError[]
}

interface ImportResult {
  success: boolean
  error?: string
  preview?: ImportPreview
  imported?: { collections: number; skripts: number; pages: number; files: number }
  warnings?: ImportError[]
  // For job manager compatibility
  collectionsCreated?: number
  skriptsCreated?: number
  pagesCreated?: number
  filesImported?: number
}

export type { ImportResult, ExportManifest }

/**
 * Server Action for importing content (supports large files via serverActions.bodySizeLimit)
 */
export async function importContent(formData: FormData, action: 'preview' | 'import' = 'preview'): Promise<ImportResult> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized' }
    }

    const file = formData.get('file') as File | null
    if (!file) {
      return { success: false, error: 'No file uploaded' }
    }

    // Load zip
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)

    // Read manifest
    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) {
      return { success: false, error: 'Invalid export: missing manifest.json' }
    }

    const manifestContent = await manifestFile.async('string')
    let manifest: ExportManifest

    try {
      manifest = JSON.parse(manifestContent)
    } catch {
      return { success: false, error: 'Invalid manifest.json: not valid JSON' }
    }

    if (manifest.version !== 2) {
      return { success: false, error: `Unsupported manifest version: ${manifest.version}` }
    }

    const userId = session.user.id
    const errors: ImportError[] = []

    // Dedup collections by title within this user's site.
    const existingCollections = await prisma.collection.findMany({
      where: {
        title: { in: manifest.collections.map(c => c.title) },
        site: { userId }
      },
      select: { title: true }
    })
    const existingCollectionTitles = new Set(existingCollections.map(c => c.title))

    const existingSkripts = await prisma.skript.findMany({
      where: {
        slug: { in: Object.keys(manifest.skripts) },
        authors: { some: { userId } }
      },
      select: { slug: true }
    })
    const existingSkriptSlugs = new Set(existingSkripts.map(s => s.slug))

    // Validate skripts and pages
    let totalAttachments = 0

    for (const [skriptSlug, skriptData] of Object.entries(manifest.skripts)) {
      const skriptFolder = zip.folder(skriptSlug)

      if (!skriptFolder) {
        errors.push({
          type: 'error',
          location: skriptSlug,
          message: `Folder not found in zip`
        })
        continue
      }

      // Check pages exist
      const mdFiles: string[] = []
      skriptFolder.forEach((relativePath, file) => {
        if (relativePath.endsWith('.md') && !relativePath.includes('/')) {
          mdFiles.push(relativePath)
        }
      })

      if (mdFiles.length === 0) {
        errors.push({
          type: 'warning',
          location: skriptSlug,
          message: `No markdown files found`
        })
      }

      // Validate each markdown file
      for (const mdFile of mdFiles) {
        const file = skriptFolder.file(mdFile)
        if (!file) continue

        const content = await file.async('string')
        const syntaxErrors = validateMarkdownSyntax(content, `${skriptSlug}/${mdFile}`)
        errors.push(...syntaxErrors)
      }

      // Count attachments
      const attachmentsFolder = skriptFolder.folder('attachments')
      if (attachmentsFolder) {
        attachmentsFolder.forEach((relativePath, file) => {
          if (!file.dir) totalAttachments++
        })
      }
    }

    // Build preview
    const preview: ImportPreview = {
      collections: manifest.collections.map(c => ({
        title: c.title,
        isNew: !existingCollectionTitles.has(c.title)
      })),
      skripts: Object.entries(manifest.skripts).map(([slug, data]) => ({
        slug,
        title: data.title,
        pageCount: data.pages.length,
        isNew: !existingSkriptSlugs.has(slug)
      })),
      attachments: totalAttachments,
      errors
    }

    if (action === 'preview') {
      return { success: true, preview }
    }

    // Action === 'import' - actually perform the import
    if (errors.some(e => e.type === 'error')) {
      return { success: false, error: 'Cannot import due to errors', preview }
    }

    // Perform import
    const { errors: importErrors, ...imported } = await performImport(zip, manifest, userId)

    return {
      success: true,
      imported,
      warnings: [...errors.filter(e => e.type === 'warning'), ...importErrors]
    }
  } catch (error) {
    console.error('[import] Error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

function validateMarkdownSyntax(content: string, location: string): ImportError[] {
  const errors: ImportError[] = []

  // Check for unclosed code blocks
  const codeBlockMatches = content.match(/```/g) || []
  if (codeBlockMatches.length % 2 !== 0) {
    errors.push({
      type: 'error',
      location,
      message: 'Unclosed code block (odd number of ```)'
    })
  }

  // Check for broken image/link syntax
  const brokenImageLinks = content.match(/!\[[^\]]*\]\([^)]*$/gm)
  if (brokenImageLinks) {
    errors.push({
      type: 'error',
      location,
      message: 'Broken image/link syntax (unclosed parenthesis)'
    })
  }

  // Check for old wiki-link syntax that wasn't converted
  const wikiLinks = content.match(/\[\[[^\]]+\]\]/g)
  if (wikiLinks) {
    errors.push({
      type: 'warning',
      location,
      message: `Found ${wikiLinks.length} wiki-links that may need conversion: ${wikiLinks.slice(0, 3).join(', ')}${wikiLinks.length > 3 ? '...' : ''}`
    })
  }

  // Check for unclosed callouts
  const calloutStart = content.match(/>\s*\[![\w-]+\]/g) || []
  if (calloutStart.length > 10) {
    errors.push({
      type: 'warning',
      location,
      message: `Found ${calloutStart.length} callouts - verify they render correctly`
    })
  }

  // Check for broken table syntax
  const tableRows = content.match(/^\|.*\|$/gm) || []
  if (tableRows.length > 0) {
    const separatorRows = content.match(/^\|[-:| ]+\|$/gm) || []
    if (separatorRows.length === 0 && tableRows.length > 1) {
      errors.push({
        type: 'warning',
        location,
        message: 'Table may be missing separator row (|---|---|)'
      })
    }
  }

  // Check for potential YAML frontmatter issues
  if (content.startsWith('---')) {
    const frontmatterEnd = content.indexOf('---', 4)
    if (frontmatterEnd === -1) {
      errors.push({
        type: 'error',
        location,
        message: 'Unclosed YAML frontmatter'
      })
    }
  }

  return errors
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const [, frontmatterStr, body] = match
  const frontmatter: Record<string, string> = {}

  frontmatterStr.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      let value = line.slice(colonIndex + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      frontmatter[key] = value
    }
  })

  return { frontmatter, body }
}

const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'svg': 'image/svg+xml',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'pdf': 'application/pdf',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'json': 'application/json',
  'excalidraw': 'application/json',
  'db': 'application/x-sqlite3',
  'sqlite': 'application/x-sqlite3'
}

/**
 * Imports a single attachment (or converted .excalidraw.md → .excalidraw
 * file) through the shared saveFile() helper, instead of hand-rolling
 * upload+create — that duplication used to skip saveFile's filename
 * metadata (ContentDisposition) and its parentId-aware existence check,
 * and left orphaned S3 uploads with no matching File row whenever the DB
 * write failed after the S3 upload had already succeeded.
 *
 * Errors are caught per-file rather than thrown, so one bad attachment
 * degrades to a reported warning instead of aborting the rest of the
 * import (previously a single failure could silently truncate a
 * multi-skript import partway through).
 */
export async function importAttachmentFile(
  file: JSZip.JSZipObject,
  finalName: string,
  skriptId: string,
  userId: string,
  location: string
): Promise<{ status: 'created' | 'skipped' } | { status: 'error'; error: ImportError }> {
  try {
    // Skip if already imported (idempotent re-runs / resumed imports)
    const existingFile = await prisma.file.findFirst({
      where: { name: finalName, parentId: null, skriptId }
    })
    if (existingFile) {
      return { status: 'skipped' }
    }

    const buffer = Buffer.from(await file.async('arraybuffer'))
    const ext = finalName.endsWith('.excalidraw')
      ? 'excalidraw'
      : (finalName.split('.').pop() || 'bin')
    const contentType = ATTACHMENT_CONTENT_TYPES[ext.toLowerCase()] || 'application/octet-stream'

    await saveFile({
      buffer,
      filename: finalName,
      skriptId,
      userId,
      contentType
    })

    return { status: 'created' }
  } catch (error) {
    return {
      status: 'error',
      error: {
        type: 'error',
        location,
        message: `Failed to import "${finalName}": ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}

async function performImport(
  zip: JSZip,
  manifest: ExportManifest,
  userId: string
): Promise<{ collections: number; skripts: number; pages: number; files: number; errors: ImportError[] }> {
  // Check S3 configuration
  if (!isTeacherS3Configured()) {
    throw new Error('File storage not configured. Set SCW_TEACHER_BUCKET environment variable.')
  }

  const result = { collections: 0, skripts: 0, pages: 0, files: 0 }
  const errors: ImportError[] = []
  // Map by collection title (manifest's stable identifier since slug is gone)
  const collectionIdMap = new Map<string, string>()
  const skriptIdMap = new Map<string, string>()

  const userSite = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true },
  })
  if (!userSite) {
    throw new Error(`User ${userId} has no Site — set up a public page before importing`)
  }

  // Create or find collections (matched by title within this user's site)
  for (const collectionData of manifest.collections) {
    let collection = await prisma.collection.findFirst({
      where: {
        title: collectionData.title,
        siteId: userSite.id,
      }
    })

    if (!collection) {
      collection = await prisma.collection.create({
        data: {
          title: collectionData.title,
          // description was dropped from the Collection schema; imports
          // silently discard the field (manifest may still carry it).
          siteId: userSite.id,
        }
      })
      result.collections++
    }

    collectionIdMap.set(collectionData.title, collection.id)
  }

  // Create skripts and pages
  for (const [skriptSlug, skriptData] of Object.entries(manifest.skripts)) {
    let skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        authors: { some: { userId } }
      }
    })

    if (!skript) {
      const owningCollection = manifest.collections.find(c => c.skripts.includes(skriptSlug))
      const collectionId = owningCollection ? collectionIdMap.get(owningCollection.title) : null

      skript = await prisma.skript.create({
        data: {
          title: skriptData.title,
          description: skriptData.description,
          slug: skriptSlug,
          isPublished: false,
          authors: {
            create: { userId, permission: 'author' }
          },
          ...(collectionId && {
            collectionSkripts: {
              create: { collectionId, order: 0 }
            }
          })
        }
      })
      result.skripts++
    }

    skriptIdMap.set(skriptSlug, skript.id)

    // Process pages
    const skriptFolder = zip.folder(skriptSlug)
    if (!skriptFolder) continue

    const mdFiles: { name: string; order: number }[] = []
    skriptFolder.forEach((relativePath, file) => {
      // Match .md files but exclude .excalidraw.md (those are attachments)
      if (relativePath.endsWith('.md') && !relativePath.endsWith('.excalidraw.md') && !relativePath.includes('/')) {
        const orderMatch = relativePath.match(/^(\d+)-/)
        const order = orderMatch ? parseInt(orderMatch[1], 10) : 999
        mdFiles.push({ name: relativePath, order })
      }
    })
    mdFiles.sort((a, b) => a.order - b.order)

    for (let i = 0; i < mdFiles.length; i++) {
      const mdFile = mdFiles[i]
      const file = skriptFolder.file(mdFile.name)
      if (!file) continue

      const content = await file.async('string')
      const { frontmatter, body } = parseFrontmatter(content)

      const slugMatch = mdFile.name.match(/^\d+-(.+)\.md$/)
      const pageSlug = slugMatch ? slugMatch[1] : mdFile.name.replace('.md', '')

      const existingPage = await prisma.page.findFirst({
        where: {
          slug: pageSlug,
          skriptId: skript.id
        }
      })

      if (!existingPage) {
        const title = frontmatter.title || pageSlug.replace(/-/g, ' ')

        const page = await prisma.page.create({
          data: {
            title,
            content: body,
            slug: pageSlug,
            order: i,
            isPublished: false,
            skriptId: skript.id,
            authors: {
              create: { userId, permission: 'author' }
            }
          }
        })

        await prisma.pageVersion.create({
          data: {
            pageId: page.id,
            content: body,
            version: 1,
            authorId: userId,
            changeLog: 'Imported'
          }
        })

        result.pages++
      }
    }

    // Process .excalidraw.md files in the root (convert to .excalidraw)
    const excalidrawFiles: string[] = []
    skriptFolder.forEach((relativePath, file) => {
      if (relativePath.endsWith('.excalidraw.md') && !relativePath.includes('/')) {
        excalidrawFiles.push(relativePath)
      }
    })

    for (const excalidrawMdFile of excalidrawFiles) {
      const file = skriptFolder.file(excalidrawMdFile)
      if (!file) continue

      // Rename from .excalidraw.md to .excalidraw
      const newName = excalidrawMdFile.replace(/\.excalidraw\.md$/, '.excalidraw')

      const imported = await importAttachmentFile(file, newName, skript.id, userId, `${skriptSlug}/${newName}`)
      if (imported.status === 'created') result.files++
      else if (imported.status === 'error') errors.push(imported.error)
    }

    // Process attachments
    const attachmentsFolder = skriptFolder.folder('attachments')
    if (attachmentsFolder) {
      const attachmentFiles: string[] = []
      attachmentsFolder.forEach((relativePath, file) => {
        if (!file.dir) attachmentFiles.push(relativePath)
      })

      for (const attachmentName of attachmentFiles) {
        const file = attachmentsFolder.file(attachmentName)
        if (!file) continue

        // Rename .excalidraw.md to .excalidraw
        const finalName = attachmentName.endsWith('.excalidraw.md')
          ? attachmentName.replace(/\.excalidraw\.md$/, '.excalidraw')
          : attachmentName

        const imported = await importAttachmentFile(file, finalName, skript.id, userId, `${skriptSlug}/attachments/${finalName}`)
        if (imported.status === 'created') result.files++
        else if (imported.status === 'error') errors.push(imported.error)
      }
    }
  }

  // Invalidate cache so imported content is visible immediately. `userSite`
  // was fetched at the top of this function and is guaranteed non-null here.
  if (userSite.slug) {
    revalidateTag(CACHE_TAGS.teacherContent(userSite.slug), { expire: 0 })
    revalidatePath(`/${userSite.slug}`)
    revalidatePath('/dashboard')
  }

  return { ...result, errors }
}

/**
 * Process import from a pre-loaded ZIP with progress callback
 * Used by the import job manager for large file imports via S3
 */
export async function processImportZip(
  zip: JSZip,
  manifest: ExportManifest,
  userId: string,
  onProgress?: (progress: number, message: string) => Promise<void>
): Promise<ImportResult> {
  // Check S3 configuration
  if (!isTeacherS3Configured()) {
    throw new Error('File storage not configured. Set SCW_TEACHER_BUCKET environment variable.')
  }

  const result = {
    collectionsCreated: 0,
    skriptsCreated: 0,
    pagesCreated: 0,
    filesImported: 0
  }
  const errors: ImportError[] = []
  const collectionIdMap = new Map<string, string>()
  const skriptIdMap = new Map<string, string>()

  const totalSkripts = Object.keys(manifest.skripts).length
  let processedSkripts = 0

  // Create or find collections (matched by title within the user's site).
  await onProgress?.(0, 'Creating collections...')
  const userSite2 = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true },
  })
  if (!userSite2) {
    throw new Error(`User ${userId} has no Site — set up a public page before importing`)
  }
  for (const collectionData of manifest.collections) {
    let collection = await prisma.collection.findFirst({
      where: {
        title: collectionData.title,
        siteId: userSite2.id,
      }
    })

    if (!collection) {
      collection = await prisma.collection.create({
        data: {
          title: collectionData.title,
          siteId: userSite2.id,
        }
      })
      result.collectionsCreated++
    }

    collectionIdMap.set(collectionData.title, collection.id)
  }

  // Create skripts and pages
  for (const [skriptSlug, skriptData] of Object.entries(manifest.skripts)) {
    processedSkripts++
    const progressPercent = Math.floor((processedSkripts / totalSkripts) * 100)
    await onProgress?.(progressPercent, `Processing skript ${processedSkripts}/${totalSkripts}: ${skriptData.title}`)

    let skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        authors: { some: { userId } }
      }
    })

    if (!skript) {
      const owningCollection = manifest.collections.find(c => c.skripts.includes(skriptSlug))
      const collectionId = owningCollection ? collectionIdMap.get(owningCollection.title) : null

      skript = await prisma.skript.create({
        data: {
          title: skriptData.title,
          description: skriptData.description,
          slug: skriptSlug,
          isPublished: false,
          authors: {
            create: { userId, permission: 'author' }
          },
          ...(collectionId && {
            collectionSkripts: {
              create: { collectionId, order: 0 }
            }
          })
        }
      })
      result.skriptsCreated++
    }

    skriptIdMap.set(skriptSlug, skript.id)

    // Process pages
    const skriptFolder = zip.folder(skriptSlug)
    if (!skriptFolder) continue

    const mdFiles: { name: string; order: number }[] = []
    skriptFolder.forEach((relativePath, file) => {
      // Match .md files but exclude .excalidraw.md (those are attachments)
      if (relativePath.endsWith('.md') && !relativePath.endsWith('.excalidraw.md') && !relativePath.includes('/')) {
        const orderMatch = relativePath.match(/^(\d+)-/)
        const order = orderMatch ? parseInt(orderMatch[1], 10) : 999
        mdFiles.push({ name: relativePath, order })
      }
    })
    mdFiles.sort((a, b) => a.order - b.order)

    for (let i = 0; i < mdFiles.length; i++) {
      const mdFile = mdFiles[i]
      const file = skriptFolder.file(mdFile.name)
      if (!file) continue

      const content = await file.async('string')
      const { frontmatter, body } = parseFrontmatter(content)

      const slugMatch = mdFile.name.match(/^\d+-(.+)\.md$/)
      const pageSlug = slugMatch ? slugMatch[1] : mdFile.name.replace('.md', '')

      const existingPage = await prisma.page.findFirst({
        where: {
          slug: pageSlug,
          skriptId: skript.id
        }
      })

      if (!existingPage) {
        const title = frontmatter.title || pageSlug.replace(/-/g, ' ')

        const page = await prisma.page.create({
          data: {
            title,
            content: body,
            slug: pageSlug,
            order: i,
            isPublished: false,
            skriptId: skript.id,
            authors: {
              create: { userId, permission: 'author' }
            }
          }
        })

        await prisma.pageVersion.create({
          data: {
            pageId: page.id,
            content: body,
            version: 1,
            authorId: userId,
            changeLog: 'Imported'
          }
        })

        result.pagesCreated++
      }
    }

    // Process .excalidraw.md files in the root (convert to .excalidraw)
    const excalidrawFiles: string[] = []
    skriptFolder.forEach((relativePath, file) => {
      if (relativePath.endsWith('.excalidraw.md') && !relativePath.includes('/')) {
        excalidrawFiles.push(relativePath)
      }
    })

    for (const excalidrawMdFile of excalidrawFiles) {
      const file = skriptFolder.file(excalidrawMdFile)
      if (!file) continue

      // Rename from .excalidraw.md to .excalidraw
      const newName = excalidrawMdFile.replace(/\.excalidraw\.md$/, '.excalidraw')

      const imported = await importAttachmentFile(file, newName, skript.id, userId, `${skriptSlug}/${newName}`)
      if (imported.status === 'created') result.filesImported++
      else if (imported.status === 'error') errors.push(imported.error)
    }

    // Process attachments
    const attachmentsFolder = skriptFolder.folder('attachments')
    if (attachmentsFolder) {
      const attachmentFiles: string[] = []
      attachmentsFolder.forEach((relativePath, file) => {
        if (!file.dir) attachmentFiles.push(relativePath)
      })

      for (const attachmentName of attachmentFiles) {
        const file = attachmentsFolder.file(attachmentName)
        if (!file) continue

        // Rename .excalidraw.md to .excalidraw
        const finalName = attachmentName.endsWith('.excalidraw.md')
          ? attachmentName.replace(/\.excalidraw\.md$/, '.excalidraw')
          : attachmentName

        const imported = await importAttachmentFile(file, finalName, skript.id, userId, `${skriptSlug}/attachments/${finalName}`)
        if (imported.status === 'created') result.filesImported++
        else if (imported.status === 'error') errors.push(imported.error)
      }
    }
  }

  // Invalidate cache so imported content is visible immediately
  const userSite = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { slug: true }
  })
  if (userSite?.slug) {
    revalidateTag(CACHE_TAGS.teacherContent(userSite.slug), { expire: 0 })
    revalidatePath(`/${userSite.slug}`)
    revalidatePath('/dashboard')
  }

  // An import writes File rows across several skripts; one sweep covers them
  // all. getSkriptFiles caches until this tag is dropped.
  invalidateSkriptFiles()

  return {
    success: true,
    ...result,
    warnings: errors
  }
}
