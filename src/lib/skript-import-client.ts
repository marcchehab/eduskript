'use client'

/**
 * Client-side skript import. Mirrors skript-export-client.ts: runs entirely
 * in the browser. The zip is unzipped and validated locally (no upload of
 * the raw zip to the server), page/collection/skript metadata goes to the
 * server as small JSON (createImportStructure), and attachment/video bytes
 * go straight from the browser to S3/Mux via the same presigned-upload
 * routes the dashboard's file/video upload UI already uses — the server
 * never buffers the zip or the media it contains.
 *
 * Supersedes the whole-zip-upload flow in import-actions.ts / api/import
 * (still present, no longer wired to any UI — see skript-export-client.ts
 * for the export-side precedent).
 */

import type JSZip from 'jszip'
import type { ExportManifest, ImportError } from '@/lib/import-shared'
import { validateMarkdownSyntax, parseFrontmatter, attachmentContentType } from '@/lib/import-shared'
import { checkImportTargets, createImportStructure } from '@/lib/import-actions'

export interface ParsedPage {
  slug: string
  title: string
  content: string
  order: number
}

export interface ParsedAttachment {
  name: string
  entry: JSZip.JSZipObject
}

export interface ParsedVideo {
  filename: string
  entry: JSZip.JSZipObject
}

export interface ParsedSkript {
  slug: string
  title: string
  description: string | null
  pages: ParsedPage[]
  attachments: ParsedAttachment[]
  videos: ParsedVideo[]
}

export interface ParsedImport {
  manifest: ExportManifest
  skripts: ParsedSkript[]
  errors: ImportError[]
}

export interface ImportPreview {
  collections: { title: string; isNew: boolean }[]
  skripts: { slug: string; title: string; pageCount: number; attachments: number; videos: number; isNew: boolean }[]
  errors: ImportError[]
}

export type ImportStage = 'structure' | 'attachments' | 'videos' | 'done'

export interface ImportProgress {
  stage: ImportStage
  current: number
  total: number
  label?: string
}

export interface ImportOutcome {
  collectionsCreated: number
  skriptsCreated: number
  pagesCreated: number
  filesImported: number
  videosImported: number
  errors: ImportError[]
}

/** Renames the legacy .excalidraw.md attachment naming to .excalidraw, unchanged otherwise. */
function finalAttachmentName(rawName: string): string {
  return rawName.endsWith('.excalidraw.md') ? rawName.replace(/\.excalidraw\.md$/, '.excalidraw') : rawName
}

/**
 * Unzips and validates the export in the browser. Pure parsing — no
 * network calls, so this can run as soon as a file is selected.
 */
export async function parseImportZip(file: File): Promise<ParsedImport> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(file)

  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) {
    throw new Error('Invalid export: missing manifest.json')
  }

  let manifest: ExportManifest
  try {
    manifest = JSON.parse(await manifestFile.async('string'))
  } catch {
    throw new Error('Invalid manifest.json: not valid JSON')
  }

  if (manifest.version !== 2) {
    throw new Error(`Unsupported manifest version: ${manifest.version}`)
  }

  const errors: ImportError[] = []
  const skripts: ParsedSkript[] = []

  for (const [skriptSlug, skriptData] of Object.entries(manifest.skripts)) {
    const skriptFolder = zip.folder(skriptSlug)
    if (!skriptFolder) {
      errors.push({ type: 'error', location: skriptSlug, message: 'Folder not found in zip' })
      continue
    }

    // Root-level markdown pages (NN-slug.md), excluding .excalidraw.md.
    const mdFiles: { name: string; order: number }[] = []
    skriptFolder.forEach((relativePath, zf) => {
      if (relativePath.endsWith('.md') && !relativePath.endsWith('.excalidraw.md') && !relativePath.includes('/')) {
        const orderMatch = relativePath.match(/^(\d+)-/)
        mdFiles.push({ name: relativePath, order: orderMatch ? parseInt(orderMatch[1], 10) : 999 })
      }
    })
    mdFiles.sort((a, b) => a.order - b.order)

    if (mdFiles.length === 0) {
      errors.push({ type: 'warning', location: skriptSlug, message: 'No markdown files found' })
    }

    const pages: ParsedPage[] = []
    for (let i = 0; i < mdFiles.length; i++) {
      const zf = skriptFolder.file(mdFiles[i].name)
      if (!zf) continue

      const content = await zf.async('string')
      errors.push(...validateMarkdownSyntax(content, `${skriptSlug}/${mdFiles[i].name}`))

      const { frontmatter, body } = parseFrontmatter(content)
      const slugMatch = mdFiles[i].name.match(/^\d+-(.+)\.md$/)
      const pageSlug = slugMatch ? slugMatch[1] : mdFiles[i].name.replace('.md', '')

      pages.push({
        slug: pageSlug,
        title: frontmatter.title || pageSlug.replace(/-/g, ' '),
        content: body,
        order: i
      })
    }

    // Legacy root-level .excalidraw.md files are attachments too.
    const attachments: ParsedAttachment[] = []
    skriptFolder.forEach((relativePath, zf) => {
      if (relativePath.endsWith('.excalidraw.md') && !relativePath.includes('/') && !zf.dir) {
        attachments.push({ name: relativePath, entry: zf })
      }
    })

    const attachmentsFolder = skriptFolder.folder('attachments')
    if (attachmentsFolder) {
      attachmentsFolder.forEach((relativePath, zf) => {
        if (!zf.dir) attachments.push({ name: relativePath, entry: zf })
      })
    }

    const videos: ParsedVideo[] = []
    const videosFolder = skriptFolder.folder('videos')
    if (videosFolder) {
      videosFolder.forEach((relativePath, zf) => {
        if (!zf.dir) videos.push({ filename: relativePath, entry: zf })
      })
    }

    skripts.push({
      slug: skriptSlug,
      title: skriptData.title,
      description: skriptData.description,
      pages,
      attachments,
      videos
    })
  }

  return { manifest, skripts, errors }
}

export async function previewImport(parsed: ParsedImport): Promise<ImportPreview> {
  const collectionTitles = parsed.manifest.collections.map(c => c.title)
  const skriptSlugs = parsed.skripts.map(s => s.slug)
  const { existingCollectionTitles, existingSkriptSlugs } = await checkImportTargets(collectionTitles, skriptSlugs)

  const existingCollections = new Set(existingCollectionTitles)
  const existingSkripts = new Set(existingSkriptSlugs)

  return {
    collections: parsed.manifest.collections.map(c => ({ title: c.title, isNew: !existingCollections.has(c.title) })),
    skripts: parsed.skripts.map(s => ({
      slug: s.slug,
      title: s.title,
      pageCount: s.pages.length,
      attachments: s.attachments.length,
      videos: s.videos.length,
      isNew: !existingSkripts.has(s.slug)
    })),
    errors: parsed.errors
  }
}

interface PresignedUpload {
  uploadUrl: string
  uploadToken: string
  uploadData: string
  signature: string
}

async function uploadAttachment(skriptId: string, name: string, attachment: ParsedAttachment): Promise<void> {
  const finalName = finalAttachmentName(name)
  const bytes = await attachment.entry.async('arraybuffer')
  const contentType = attachmentContentType(finalName)

  const presignRes = await fetch('/api/upload/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: finalName, size: bytes.byteLength, contentType, skriptId })
  })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}))
    throw new Error(err.error || `Could not get an upload URL (${presignRes.status})`)
  }
  const presigned: PresignedUpload = await presignRes.json()

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes
  })
  if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`)

  const confirmRes = await fetch('/api/upload/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploadToken: presigned.uploadToken,
      uploadData: presigned.uploadData,
      signature: presigned.signature
    })
  })
  if (!confirmRes.ok) {
    const err = await confirmRes.json().catch(() => ({}))
    throw new Error(err.error || `Could not register the upload (${confirmRes.status})`)
  }
}

async function uploadVideo(skriptId: string, video: ParsedVideo): Promise<void> {
  const bytes = await video.entry.async('arraybuffer')

  const urlRes = await fetch('/api/videos/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: video.filename, skriptId })
  })
  if (!urlRes.ok) {
    const err = await urlRes.json().catch(() => ({}))
    throw new Error(err.error || `Could not get a video upload URL (${urlRes.status})`)
  }
  const { uploadUrl } = await urlRes.json()

  const putRes = await fetch(uploadUrl, { method: 'PUT', body: bytes })
  if (!putRes.ok) throw new Error(`Upload to Mux failed (${putRes.status})`)
  // Video row already exists (created by /api/videos/upload-url); Mux's
  // webhook fills in muxAssetId/playbackId asynchronously once processed,
  // same as a normal dashboard video upload.
}

/**
 * Creates the collection/skript/page structure, then uploads attachments
 * and videos directly to S3/Mux against the resulting skript ids. Each
 * attachment/video failure is caught and reported rather than aborting
 * the rest of the import.
 */
export async function importParsedZip(
  parsed: ParsedImport,
  onProgress: (p: ImportProgress) => void
): Promise<ImportOutcome> {
  if (parsed.errors.some(e => e.type === 'error')) {
    throw new Error('Cannot import: fix the blocking errors shown in the preview first.')
  }

  const errors: ImportError[] = [...parsed.errors.filter(e => e.type === 'warning')]

  onProgress({ stage: 'structure', current: 0, total: 1 })
  const structure = await createImportStructure({
    collections: parsed.manifest.collections.map(c => ({ title: c.title, skripts: c.skripts })),
    skripts: parsed.skripts.map(s => ({
      slug: s.slug,
      title: s.title,
      description: s.description,
      pages: s.pages
    }))
  })

  if (!structure.success || !structure.skriptIds) {
    throw new Error(structure.error || 'Could not create the imported content')
  }

  let filesImported = 0
  let videosImported = 0

  const attachmentJobs = parsed.skripts.flatMap(s =>
    s.attachments.map(a => ({ skriptSlug: s.slug, attachment: a }))
  )
  for (let i = 0; i < attachmentJobs.length; i++) {
    const { skriptSlug, attachment } = attachmentJobs[i]
    onProgress({ stage: 'attachments', current: i, total: attachmentJobs.length, label: attachment.name })
    const skriptId = structure.skriptIds[skriptSlug]
    try {
      await uploadAttachment(skriptId, attachment.name, attachment)
      filesImported++
    } catch (err) {
      errors.push({
        type: 'error',
        location: `${skriptSlug}/attachments/${attachment.name}`,
        message: `Failed to import "${attachment.name}": ${err instanceof Error ? err.message : err}`
      })
    }
  }

  const videoJobs = parsed.skripts.flatMap(s => s.videos.map(v => ({ skriptSlug: s.slug, video: v })))
  for (let i = 0; i < videoJobs.length; i++) {
    const { skriptSlug, video } = videoJobs[i]
    onProgress({ stage: 'videos', current: i, total: videoJobs.length, label: video.filename })
    const skriptId = structure.skriptIds[skriptSlug]
    try {
      await uploadVideo(skriptId, video)
      videosImported++
    } catch (err) {
      errors.push({
        type: 'error',
        location: `${skriptSlug}/videos/${video.filename}`,
        message: `Failed to import "${video.filename}": ${err instanceof Error ? err.message : err}`
      })
    }
  }

  onProgress({ stage: 'done', current: 1, total: 1 })

  return {
    collectionsCreated: structure.collectionsCreated || 0,
    skriptsCreated: structure.skriptsCreated || 0,
    pagesCreated: structure.pagesCreated || 0,
    filesImported,
    videosImported,
    errors
  }
}
