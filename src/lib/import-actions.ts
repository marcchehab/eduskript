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
import {
  type ExportManifest,
  type ImportError,
  validateMarkdownSyntax,
  parseFrontmatter,
  attachmentContentType
} from '@/lib/import-shared'

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

    await saveFile({
      buffer,
      filename: finalName,
      skriptId,
      userId,
      contentType: attachmentContentType(finalName)
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

export interface ImportTargetsCheck {
  existingCollectionTitles: string[]
  existingSkriptSlugs: string[]
}

/**
 * Read-only dedupe check for the client-side importer's preview step.
 * Attachments/videos aren't checked here — those go straight through
 * saveFile()'s / the Mux upload route's own existence checks per-file.
 */
export async function checkImportTargets(collectionTitles: string[], skriptSlugs: string[]): Promise<ImportTargetsCheck> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { existingCollectionTitles: [], existingSkriptSlugs: [] }
  }
  const userId = session.user.id

  const [existingCollections, existingSkripts] = await Promise.all([
    collectionTitles.length > 0
      ? prisma.collection.findMany({
          where: { title: { in: collectionTitles }, site: { userId } },
          select: { title: true }
        })
      : Promise.resolve([]),
    skriptSlugs.length > 0
      ? prisma.skript.findMany({
          where: { slug: { in: skriptSlugs }, authors: { some: { userId } } },
          select: { slug: true }
        })
      : Promise.resolve([])
  ])

  return {
    existingCollectionTitles: existingCollections.map(c => c.title),
    existingSkriptSlugs: existingSkripts.map(s => s.slug)
  }
}

export interface ImportStructurePayload {
  collections: { title: string; skripts: string[] }[]
  skripts: {
    slug: string
    title: string
    description: string | null
    pages: { slug: string; title: string; content: string; order: number }[]
  }[]
}

export interface ImportStructureResult {
  success: boolean
  error?: string
  skriptIds?: Record<string, string>
  collectionsCreated?: number
  skriptsCreated?: number
  pagesCreated?: number
}

/**
 * Client-side importer's write step for collections/skripts/pages — text
 * only, no binary. Attachments and videos are uploaded separately by the
 * browser directly to S3/Mux (see skript-import-client.ts) once this
 * returns the new skript ids to attach them to.
 */
export async function createImportStructure(payload: ImportStructurePayload): Promise<ImportStructureResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }
  const userId = session.user.id

  const result = { collectionsCreated: 0, skriptsCreated: 0, pagesCreated: 0 }
  const skriptIds: Record<string, string> = {}
  const collectionIdMap = new Map<string, string>()

  const userSite = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true }
  })
  if (!userSite) {
    return { success: false, error: `User ${userId} has no Site — set up a public page before importing` }
  }

  for (const collectionData of payload.collections) {
    let collection = await prisma.collection.findFirst({
      where: { title: collectionData.title, siteId: userSite.id }
    })
    if (!collection) {
      collection = await prisma.collection.create({
        data: { title: collectionData.title, siteId: userSite.id }
      })
      result.collectionsCreated++
    }
    collectionIdMap.set(collectionData.title, collection.id)
  }

  for (const skriptData of payload.skripts) {
    let skript = await prisma.skript.findFirst({
      where: { slug: skriptData.slug, authors: { some: { userId } } }
    })

    if (!skript) {
      const owningCollection = payload.collections.find(c => c.skripts.includes(skriptData.slug))
      const collectionId = owningCollection ? collectionIdMap.get(owningCollection.title) : null

      skript = await prisma.skript.create({
        data: {
          title: skriptData.title,
          description: skriptData.description,
          slug: skriptData.slug,
          isPublished: false,
          authors: { create: { userId, permission: 'author' } },
          ...(collectionId && {
            collectionSkripts: { create: { collectionId, order: 0 } }
          })
        }
      })
      result.skriptsCreated++
    }

    skriptIds[skriptData.slug] = skript.id

    for (const p of skriptData.pages) {
      const existingPage = await prisma.page.findFirst({
        where: { slug: p.slug, skriptId: skript.id }
      })
      if (existingPage) continue

      const page = await prisma.page.create({
        data: {
          title: p.title,
          content: p.content,
          slug: p.slug,
          order: p.order,
          isPublished: false,
          skriptId: skript.id,
          authors: { create: { userId, permission: 'author' } }
        }
      })

      await prisma.pageVersion.create({
        data: {
          pageId: page.id,
          content: p.content,
          version: 1,
          authorId: userId,
          changeLog: 'Imported'
        }
      })

      result.pagesCreated++
    }
  }

  if (userSite.slug) {
    revalidateTag(CACHE_TAGS.teacherContent(userSite.slug), { expire: 0 })
    revalidatePath(`/${userSite.slug}`)
    revalidatePath('/dashboard')
  }

  return { success: true, skriptIds, ...result }
}
