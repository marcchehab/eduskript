'use client'

/**
 * Client-side skript export. Runs entirely in the browser: fetches page
 * content + file/video metadata as JSON, downloads attachment and video
 * bytes directly from S3/Mux, then zips (JSZip) or writes to a picked
 * folder (File System Access API — Chromium only). No server-side
 * buffering, unlike the old /api/export route it replaces (see
 * src/app/api/export/route.ts, no longer wired to any UI).
 *
 * Zip layout matches the server export's manifest format (version 2) so
 * the existing import flow (src/lib/import-actions.ts) can read it back,
 * plus a videos/ folder that import does not yet consume.
 */

export interface ExportPage {
  slug: string
  title: string
  content: string
}

export interface ExportFile {
  id: string
  name: string
  url: string
}

export interface ExportVideo {
  id: string
  filename: string
  playbackId?: string
  muxAssetId: string | null
}

export interface ExportSkript {
  id: string
  slug: string
  title: string
  description: string | null
  pages: ExportPage[]
}

export interface LicenseAuthor {
  userId: string
  name: string | null
  siteSlug: string | null
}

export interface LicenseForkedPage {
  pageSlug: string
  pageTitle: string
  originalPageSlug: string | null
  originalPageTitle: string | null
  originalSkriptSlug: string | null
  originalAuthorName: string | null
  originalAuthorSiteSlug: string | null
}

export interface ExportedBy {
  userId: string
  name: string | null
}

export type ExportStage = 'fetching' | 'attachments' | 'videos' | 'zipping' | 'writing' | 'done'

export interface ExportProgress {
  stage: ExportStage
  current: number
  total: number
  label?: string
}

export interface ExportOutcome {
  errors: string[]
}

const VIDEO_POLL_INTERVAL_MS = 4000
const VIDEO_POLL_ATTEMPTS = 30 // ~2 minutes

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function pageFilename(index: number, slug: string) {
  return `${String(index + 1).padStart(2, '0')}-${slug}.md`
}

function pageContent(page: ExportPage) {
  return `---\ntitle: "${page.title.replace(/"/g, '\\"')}"\n---\n\n${page.content}`
}

function buildManifest(skript: ExportSkript) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    collections: [],
    skripts: {
      [skript.slug]: {
        title: skript.title,
        description: skript.description,
        pages: skript.pages.map(p => p.slug)
      }
    }
  }
}

export async function fetchExportData(skriptId: string): Promise<{
  skript: ExportSkript
  files: ExportFile[]
  videos: ExportVideo[]
  authors: LicenseAuthor[]
  forkedPages: LicenseForkedPage[]
}> {
  const [skriptRes, filesRes, licenseRes] = await Promise.all([
    fetch(`/api/skripts/${skriptId}`),
    fetch(`/api/skripts/${skriptId}/files`),
    fetch(`/api/skripts/${skriptId}/license`)
  ])

  if (!skriptRes.ok) throw new Error('Skript could not be loaded')
  if (!filesRes.ok) throw new Error('Files could not be loaded')
  if (!licenseRes.ok) throw new Error('License information could not be loaded')

  const skriptJson = await skriptRes.json()
  const filesJson = await filesRes.json()
  const licenseJson = await licenseRes.json()

  const skript: ExportSkript = {
    id: skriptJson.data.id,
    slug: skriptJson.data.slug,
    title: skriptJson.data.title,
    description: skriptJson.data.description,
    pages: skriptJson.data.pages.map((p: { slug: string; title: string; content: string }) => ({
      slug: p.slug,
      title: p.title,
      content: p.content
    }))
  }

  return {
    skript,
    files: filesJson.files,
    videos: filesJson.videos,
    authors: licenseJson.authors,
    forkedPages: licenseJson.forkedPages
  }
}

function authorLine(name: string | null, siteSlug: string | null): string {
  const label = name || 'Unknown'
  return siteSlug ? `- ${label} (${typeof window !== 'undefined' ? window.location.origin : ''}/${siteSlug})` : `- ${label}`
}

function buildLicenseText(
  skript: ExportSkript,
  authors: LicenseAuthor[],
  forkedPages: LicenseForkedPage[],
  exportedBy: ExportedBy | null
): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const isAuthor = !!exportedBy && authors.some(a => a.userId === exportedBy.userId)

  const lines: string[] = []
  lines.push('Eduskript Content License')
  lines.push('==========================')
  lines.push('')
  lines.push(`Skript: ${skript.title}`)
  lines.push(`Exported: ${new Date().toISOString().split('T')[0]}${exportedBy ? ` by ${exportedBy.name || 'Unknown'}` : ''}`)
  lines.push('')
  lines.push('License: CC BY-NC-SA 4.0 (Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International)')
  lines.push('https://creativecommons.org/licenses/by-nc-sa/4.0/')
  lines.push('')
  lines.push('Author(s):')
  if (authors.length > 0) {
    authors.forEach(a => lines.push(authorLine(a.name, a.siteSlug)))
  } else {
    lines.push('- Unknown')
  }

  if (forkedPages.length > 0) {
    lines.push('')
    lines.push('This skript contains pages forked from other authors:')
    forkedPages.forEach(fp => {
      const originalUrl = fp.originalAuthorSiteSlug && fp.originalSkriptSlug && fp.originalPageSlug
        ? `${origin}/${fp.originalAuthorSiteSlug}/${fp.originalSkriptSlug}/${fp.originalPageSlug}`
        : fp.originalAuthorSiteSlug
          ? `${origin}/${fp.originalAuthorSiteSlug}`
          : null
      lines.push(
        `- "${fp.pageTitle}" forked from "${fp.originalPageTitle || 'unknown page'}" by ${fp.originalAuthorName || 'unknown author'}` +
        (originalUrl ? ` (${originalUrl})` : '')
      )
    })
  }

  lines.push('')
  lines.push('Summary:')
  lines.push('- You may share and adapt this content for non-commercial purposes.')
  lines.push('- Any adaptation must be shared under the same CC BY-NC-SA 4.0 license (share-alike).')
  lines.push('- Credit the author(s) listed above.')
  lines.push('- Commercial use (paid courses, textbooks, for-profit training) is not permitted.')
  lines.push('')
  lines.push('Full license text: https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode')

  if (exportedBy && !isAuthor) {
    lines.push('')
    lines.push('Note: you exported this as a collaborator with read/edit access, not as the')
    lines.push('original author. Ownership and the license terms above belong to the')
    lines.push('author(s) listed, not to you.')
  }

  return lines.join('\n') + '\n'
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Polls prepare-download until a video's static MP4 rendition is ready. */
async function resolveVideoUrl(video: ExportVideo): Promise<string> {
  if (!video.muxAssetId) throw new Error('Video is not ready on Mux yet')

  for (let attempt = 0; attempt < VIDEO_POLL_ATTEMPTS; attempt++) {
    const res = await fetch(`/api/videos/${video.id}/prepare-download`, { method: 'POST' })
    const data = await res.json()
    if (data.status === 'ready') return data.url
    if (data.status === 'error') throw new Error(data.error || 'Mux error')
    await sleep(VIDEO_POLL_INTERVAL_MS)
  }
  throw new Error('Timed out preparing the video')
}

export async function exportSkriptAsZip(
  skriptId: string,
  onProgress: (p: ExportProgress) => void,
  exportedBy: ExportedBy | null = null
): Promise<ExportOutcome> {
  onProgress({ stage: 'fetching', current: 0, total: 1 })
  const { skript, files, videos, authors, forkedPages } = await fetchExportData(skriptId)

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const root = zip.folder(skript.slug)!

  skript.pages.forEach((page, i) => root.file(pageFilename(i, page.slug), pageContent(page)))

  const errors: string[] = []

  if (files.length > 0) {
    const attachmentsFolder = root.folder('attachments')!
    for (let i = 0; i < files.length; i++) {
      onProgress({ stage: 'attachments', current: i, total: files.length, label: files[i].name })
      try {
        attachmentsFolder.file(files[i].name, await fetchBytes(files[i].url))
      } catch (err) {
        errors.push(`Attachment "${files[i].name}" could not be downloaded: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  if (videos.length > 0) {
    const videosFolder = root.folder('videos')!
    for (let i = 0; i < videos.length; i++) {
      onProgress({ stage: 'videos', current: i, total: videos.length, label: videos[i].filename })
      try {
        const url = await resolveVideoUrl(videos[i])
        videosFolder.file(videos[i].filename, await fetchBytes(url))
      } catch (err) {
        errors.push(`Video "${videos[i].filename}" could not be downloaded: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  zip.file('manifest.json', JSON.stringify(buildManifest(skript), null, 2))
  root.file('LICENSE.txt', buildLicenseText(skript, authors, forkedPages, exportedBy))

  onProgress({ stage: 'zipping', current: 0, total: 1 })
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${skript.slug}-export.zip`
  a.click()
  URL.revokeObjectURL(a.href)

  onProgress({ stage: 'done', current: 1, total: 1 })
  return { errors }
}

export async function exportSkriptToDirectory(
  skriptId: string,
  onProgress: (p: ExportProgress) => void,
  exportedBy: ExportedBy | null = null
): Promise<ExportOutcome> {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser does not support folder selection')
  }
  const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' })

  onProgress({ stage: 'fetching', current: 0, total: 1 })
  const { skript, files, videos, authors, forkedPages } = await fetchExportData(skriptId)

  const skriptDir = await rootHandle.getDirectoryHandle(skript.slug, { create: true })

  async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: string | Uint8Array) {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(data as BufferSource | string)
    await writable.close()
  }

  const errors: string[] = []

  for (let i = 0; i < skript.pages.length; i++) {
    await writeFile(skriptDir, pageFilename(i, skript.pages[i].slug), pageContent(skript.pages[i]))
  }

  if (files.length > 0) {
    const attachmentsDir = await skriptDir.getDirectoryHandle('attachments', { create: true })
    for (let i = 0; i < files.length; i++) {
      onProgress({ stage: 'attachments', current: i, total: files.length, label: files[i].name })
      try {
        await writeFile(attachmentsDir, files[i].name, await fetchBytes(files[i].url))
      } catch (err) {
        errors.push(`Attachment "${files[i].name}" could not be downloaded: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  if (videos.length > 0) {
    const videosDir = await skriptDir.getDirectoryHandle('videos', { create: true })
    for (let i = 0; i < videos.length; i++) {
      onProgress({ stage: 'videos', current: i, total: videos.length, label: videos[i].filename })
      try {
        const url = await resolveVideoUrl(videos[i])
        await writeFile(videosDir, videos[i].filename, await fetchBytes(url))
      } catch (err) {
        errors.push(`Video "${videos[i].filename}" could not be downloaded: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  onProgress({ stage: 'writing', current: 0, total: 1 })
  await writeFile(rootHandle, 'manifest.json', JSON.stringify(buildManifest(skript), null, 2))
  await writeFile(skriptDir, 'LICENSE.txt', buildLicenseText(skript, authors, forkedPages, exportedBy))

  onProgress({ stage: 'done', current: 1, total: 1 })
  return { errors }
}
