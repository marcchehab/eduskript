import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import JSZip from 'jszip'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import Busboy from 'busboy'
import { startImportProcessing, getJobStatus, cancelImportJob } from '@/lib/import-job-manager'

/**
 * Parse multipart form data using busboy (streaming, bypasses body size limits)
 */
async function parseMultipartForm(request: Request): Promise<{ file: Buffer | null; filename: string | null }> {
  return new Promise((resolve, reject) => {
    const contentType = request.headers.get('content-type')
    if (!contentType) {
      reject(new Error('Missing content-type header'))
      return
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } })
    let fileBuffer: Buffer | null = null
    let filename: string | null = null

    busboy.on('file', (fieldname, file, info) => {
      const chunks: Buffer[] = []
      filename = info.filename

      file.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks)
      })
    })

    busboy.on('finish', () => {
      resolve({ file: fileBuffer, filename })
    })

    busboy.on('error', (error: Error) => {
      reject(error)
    })

    // Convert Web ReadableStream to Node.js stream and pipe to busboy
    const reader = request.body?.getReader()
    if (!reader) {
      reject(new Error('No request body'))
      return
    }

    const nodeStream = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read()
          if (done) {
            this.push(null)
          } else {
            this.push(Buffer.from(value))
          }
        } catch (error) {
          this.destroy(error as Error)
        }
      }
    })

    nodeStream.pipe(busboy)
  })
}

interface ExportManifest {
  version: number
  exportedAt: string
  collections: {
    slug: string
    title: string
    description: string | null
    skripts: string[]
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
  collections: { slug: string; title: string; isNew: boolean }[]
  skripts: { slug: string; title: string; pageCount: number; isNew: boolean }[]
  attachments: number
  errors: ImportError[]
}

/**
 * POST /api/import/preview
 * Preview what will be imported without making changes
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'preview'

    // Handle async import start (after S3 upload)
    if (action === 'start') {
      const jobId = searchParams.get('jobId')
      if (!jobId) {
        return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
      }

      // Find the job and verify ownership
      const job = await prisma.importJob.findFirst({
        where: {
          id: jobId,
          userId: session.user.id,
          status: 'pending'
        }
      })

      if (!job) {
        return NextResponse.json({ error: 'Job not found or already started' }, { status: 404 })
      }

      if (!job.s3Key) {
        return NextResponse.json({ error: 'Job has no S3 key' }, { status: 400 })
      }

      // Update status to uploading complete, start processing
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'processing',
          message: 'Starting import...'
        }
      })

      // Start async processing (returns immediately)
      startImportProcessing(jobId, session.user.id, job.s3Key)

      return NextResponse.json({
        success: true,
        jobId,
        message: 'Import started'
      })
    }

    // Use streaming parser to bypass Next.js body size limits
    const { file: fileBuffer } = await parseMultipartForm(request)

    if (!fileBuffer) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    // Load zip from buffer
    const zip = await JSZip.loadAsync(fileBuffer)

    // Read manifest
    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) {
      return NextResponse.json({ error: 'Invalid export: missing manifest.json' }, { status: 400 })
    }

    const manifestContent = await manifestFile.async('string')
    let manifest: ExportManifest

    try {
      manifest = JSON.parse(manifestContent)
    } catch {
      return NextResponse.json({ error: 'Invalid manifest.json: not valid JSON' }, { status: 400 })
    }

    if (manifest.version !== 1) {
      return NextResponse.json({ error: `Unsupported manifest version: ${manifest.version}` }, { status: 400 })
    }

    const userId = session.user.id
    const errors: ImportError[] = []

    // Check for existing collections and skripts
    const existingCollections = await prisma.collection.findMany({
      where: {
        slug: { in: manifest.collections.map(c => c.slug) },
        authors: { some: { userId } }
      },
      select: { slug: true }
    })
    const existingCollectionSlugs = new Set(existingCollections.map(c => c.slug))

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

        // Check for common syntax issues
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
        slug: c.slug,
        title: c.title,
        isNew: !existingCollectionSlugs.has(c.slug)
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
      return NextResponse.json(preview)
    }

    // Action === 'import' - actually perform the import
    if (errors.some(e => e.type === 'error')) {
      return NextResponse.json({
        error: 'Cannot import due to errors',
        preview
      }, { status: 400 })
    }

    // Perform import
    const result = await performImport(zip, manifest, userId)

    return NextResponse.json({
      success: true,
      imported: result,
      warnings: errors.filter(e => e.type === 'warning')
    })
  } catch (error) {
    console.error('[import] Error:', error)
    return NextResponse.json(
      { error: 'Import failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Validate markdown syntax and return any errors
 */
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
  // This is just a warning since callouts can span multiple lines
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
    // Check if there's a separator row
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

/**
 * Parse frontmatter from markdown content
 */
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
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      frontmatter[key] = value
    }
  })

  return { frontmatter, body }
}

/**
 * Perform the actual import
 */
async function performImport(
  zip: JSZip,
  manifest: ExportManifest,
  userId: string
): Promise<{ collections: number; skripts: number; pages: number; files: number }> {
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')

  // Ensure upload directory exists
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true })
  }

  const result = { collections: 0, skripts: 0, pages: 0, files: 0 }
  const collectionIdMap = new Map<string, string>() // slug -> id
  const skriptIdMap = new Map<string, string>() // slug -> id

  // Create or find collections
  for (const collectionData of manifest.collections) {
    let collection = await prisma.collection.findFirst({
      where: {
        slug: collectionData.slug,
        authors: { some: { userId } }
      }
    })

    if (!collection) {
      collection = await prisma.collection.create({
        data: {
          title: collectionData.title,
          description: collectionData.description,
          slug: collectionData.slug,
          isPublished: false,
          authors: {
            create: { userId, permission: 'author' }
          }
        }
      })
      result.collections++
    }

    collectionIdMap.set(collectionData.slug, collection.id)
  }

  // Create skripts and pages
  for (const [skriptSlug, skriptData] of Object.entries(manifest.skripts)) {
    // Check if skript exists
    let skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        authors: { some: { userId } }
      }
    })

    if (!skript) {
      // Find which collection this skript belongs to
      const collectionSlug = manifest.collections.find(c => c.skripts.includes(skriptSlug))?.slug
      const collectionId = collectionSlug ? collectionIdMap.get(collectionSlug) : null

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

    // Get all markdown files sorted
    const mdFiles: { name: string; order: number }[] = []
    skriptFolder.forEach((relativePath, file) => {
      if (relativePath.endsWith('.md') && !relativePath.includes('/')) {
        // Extract order from filename (01-slug.md)
        const orderMatch = relativePath.match(/^(\d+)-/)
        const order = orderMatch ? parseInt(orderMatch[1], 10) : 999
        mdFiles.push({ name: relativePath, order })
      }
    })
    mdFiles.sort((a, b) => a.order - b.order)

    // Create pages
    for (let i = 0; i < mdFiles.length; i++) {
      const mdFile = mdFiles[i]
      const file = skriptFolder.file(mdFile.name)
      if (!file) continue

      const content = await file.async('string')
      const { frontmatter, body } = parseFrontmatter(content)

      // Extract slug from filename
      const slugMatch = mdFile.name.match(/^\d+-(.+)\.md$/)
      const pageSlug = slugMatch ? slugMatch[1] : mdFile.name.replace('.md', '')

      // Check if page exists
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

        // Create initial version
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

        // Check if file already exists
        const existingFile = await prisma.file.findFirst({
          where: {
            name: attachmentName,
            skriptId: skript.id
          }
        })

        if (!existingFile) {
          const buffer = Buffer.from(await file.async('arraybuffer'))
          const hash = createHash('sha256').update(buffer).digest('hex')
          const ext = attachmentName.split('.').pop() || 'bin'
          const physicalFilename = `${hash}.${ext}`
          const physicalPath = join(uploadDir, physicalFilename)

          // Save physical file if it doesn't exist
          if (!existsSync(physicalPath)) {
            await writeFile(physicalPath, buffer)
          }

          // Determine content type
          const contentTypeMap: Record<string, string> = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'svg': 'image/svg+xml',
            'webp': 'image/webp',
            'gif': 'image/gif',
            'pdf': 'application/pdf',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'json': 'application/json'
          }
          const contentType = contentTypeMap[ext.toLowerCase()] || 'application/octet-stream'

          await prisma.file.create({
            data: {
              name: attachmentName,
              isDirectory: false,
              skriptId: skript.id,
              hash,
              contentType,
              size: BigInt(buffer.length),
              createdBy: userId
            }
          })

          result.files++
        }
      }
    }
  }

  return result
}

/**
 * GET /api/import?action=status&jobId=xxx
 * Get the status of an import job
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const jobId = searchParams.get('jobId')

    if (action === 'status' && jobId) {
      const job = await getJobStatus(jobId, session.user.id)

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      return NextResponse.json(job)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[import] GET Error:', error)
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/import?jobId=xxx
 * Cancel an import job
 */
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')

    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
    }

    const cancelled = await cancelImportJob(jobId, session.user.id)

    if (!cancelled) {
      return NextResponse.json(
        { error: 'Job not found or cannot be cancelled' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[import] DELETE Error:', error)
    return NextResponse.json(
      { error: 'Failed to cancel job' },
      { status: 500 }
    )
  }
}
