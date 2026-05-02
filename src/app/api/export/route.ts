import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import JSZip from 'jszip'
import { downloadTeacherFile, isTeacherS3Configured } from '@/lib/s3'

interface ExportManifest {
  version: number
  exportedAt: string
  collections: {
    slug: string
    title: string
    description: string | null
    skripts: string[] // skript slugs
  }[]
  skripts: {
    [slug: string]: {
      title: string
      description: string | null
      pages: string[] // page slugs in order
    }
  }
}

/**
 * GET /api/export
 * Export all user content as a zip file
 * Query params:
 *   - collections: comma-separated collection IDs (optional, exports all if not specified)
 *   - skripts: comma-separated skript IDs (optional)
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isPaidUser(session.user)) {
      return paidOnlyResponse('Export is a paid feature.')
    }

    const { searchParams } = new URL(request.url)
    const collectionIds = searchParams.get('collections')?.split(',').filter(Boolean)
    const skriptIds = searchParams.get('skripts')?.split(',').filter(Boolean)

    const userId = session.user.id

    // Build query for collections
    const collectionsWhere = {
      authors: { some: { userId, permission: 'author' } },
      ...(collectionIds && { id: { in: collectionIds } })
    }

    // Fetch collections with skripts and pages
    const collections = await prisma.collection.findMany({
      where: collectionsWhere,
      include: {
        collectionSkripts: {
          include: {
            skript: {
              include: {
                pages: {
                  orderBy: { order: 'asc' }
                },
                files: true
              }
            }
          },
          orderBy: { order: 'asc' }
        }
      },
      orderBy: { title: 'asc' }
    })

    // If specific skripts requested, also fetch standalone skripts
    let standaloneSkripts: typeof collections[0]['collectionSkripts'][0]['skript'][] = []
    if (skriptIds) {
      standaloneSkripts = await prisma.skript.findMany({
        where: {
          id: { in: skriptIds },
          authors: { some: { userId, permission: 'author' } }
        },
        include: {
          pages: { orderBy: { order: 'asc' } },
          files: true
        }
      })
    }

    // Create zip
    const zip = new JSZip()

    // Build manifest
    const manifest: ExportManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      collections: [],
      skripts: {}
    }

    // Check S3 configuration for file exports
    const s3Configured = isTeacherS3Configured()
    const processedSkripts = new Set<string>()

    // Process collections
    for (const collection of collections) {
      const collectionSkriptSlugs: string[] = []

      for (const cs of collection.collectionSkripts) {
        const skript = cs.skript
        if (processedSkripts.has(skript.id)) continue
        processedSkripts.add(skript.id)

        collectionSkriptSlugs.push(skript.slug)

        // Add skript to manifest
        manifest.skripts[skript.slug] = {
          title: skript.title,
          description: skript.description,
          pages: skript.pages.map(p => p.slug)
        }

        // Create skript folder with pages
        const skriptFolder = zip.folder(skript.slug)
        if (!skriptFolder) continue

        // Add pages as markdown files
        for (let i = 0; i < skript.pages.length; i++) {
          const page = skript.pages[i]
          const pageFilename = `${String(i + 1).padStart(2, '0')}-${page.slug}.md`

          // Add frontmatter with title
          const content = `---\ntitle: "${page.title.replace(/"/g, '\\"')}"\n---\n\n${page.content}`
          skriptFolder.file(pageFilename, content)
        }

        // Add attachments from S3
        if (skript.files.length > 0 && s3Configured) {
          const attachmentsFolder = skriptFolder.folder('attachments')
          if (attachmentsFolder) {
            for (const file of skript.files) {
              if (file.isDirectory) continue

              // Download from S3
              if (file.hash) {
                const ext = file.name.split('.').pop() || 'bin'
                const s3Key = `files/${file.hash}.${ext}`

                try {
                  const fileBuffer = await downloadTeacherFile(s3Key)
                  attachmentsFolder.file(file.name, fileBuffer)
                } catch (err) {
                  console.error(`[export] Failed to download file ${file.name} from S3:`, err)
                }
              }
            }
          }
        }
      }

      manifest.collections.push({
        slug: collection.slug,
        title: collection.title,
        description: collection.description,
        skripts: collectionSkriptSlugs
      })
    }

    // Process standalone skripts (not in any collection)
    for (const skript of standaloneSkripts) {
      if (processedSkripts.has(skript.id)) continue
      processedSkripts.add(skript.id)

      manifest.skripts[skript.slug] = {
        title: skript.title,
        description: skript.description,
        pages: skript.pages.map(p => p.slug)
      }

      const skriptFolder = zip.folder(skript.slug)
      if (!skriptFolder) continue

      for (let i = 0; i < skript.pages.length; i++) {
        const page = skript.pages[i]
        const pageFilename = `${String(i + 1).padStart(2, '0')}-${page.slug}.md`
        const content = `---\ntitle: "${page.title.replace(/"/g, '\\"')}"\n---\n\n${page.content}`
        skriptFolder.file(pageFilename, content)
      }

      // Add attachments from S3
      if (skript.files.length > 0 && s3Configured) {
        const attachmentsFolder = skriptFolder.folder('attachments')
        if (attachmentsFolder) {
          for (const file of skript.files) {
            if (file.isDirectory) continue
            if (file.hash) {
              const ext = file.name.split('.').pop() || 'bin'
              const s3Key = `files/${file.hash}.${ext}`

              try {
                const fileBuffer = await downloadTeacherFile(s3Key)
                attachmentsFolder.file(file.name, fileBuffer)
              } catch (err) {
                console.error(`[export] Failed to download file ${file.name} from S3:`, err)
              }
            }
          }
        }
      }
    }

    // Add manifest
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    // Generate zip
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })

    // Return zip file
    const filename = `eduskript-export-${new Date().toISOString().split('T')[0]}.zip`

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zipBuffer.length)
      }
    })
  } catch (error) {
    console.error('[export] Error:', error)
    return NextResponse.json(
      { error: 'Export failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
