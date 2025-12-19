import { NextRequest, NextResponse } from 'next/server'
import { gzipSync } from 'zlib'
import { prisma } from '@/lib/prisma'
import { generateSEBConfig, getSEBMimeType, getSEBFilename } from '@/lib/seb'

/**
 * GET /api/exams/[pageId]/seb-config
 * Download SEB configuration file for an exam page
 * Publicly accessible - SEB needs to fetch this without authentication
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params

    // Get page with skript info (no auth required - config is public for exam pages)
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        pageType: 'exam' // Only serve config for exam pages
      },
      include: {
        skript: {
          include: {
            collectionSkripts: {
              include: {
                collection: true
              },
              take: 1
            },
            authors: {
              take: 1,
              include: { user: true }
            }
          }
        }
      }
    })

    if (!page) {
      return NextResponse.json({ error: 'Exam page not found' }, { status: 404 })
    }

    // Get the teacher (first author) to build the exam URL
    const teacher = page.skript.authors[0]?.user
    const collectionSkript = page.skript.collectionSkripts[0]

    if (!teacher?.pageSlug || !collectionSkript?.collection) {
      return NextResponse.json({ error: 'Invalid exam configuration' }, { status: 400 })
    }

    // Build the exam URL - use https for all external hosts, http only for localhost
    const host = request.headers.get('host') || 'eduskript.org'
    const protocol = host.startsWith('localhost') ? 'http' : 'https'
    const examUrl = `${protocol}://${host}/${teacher.pageSlug}/${collectionSkript.collection.slug}/${page.skript.slug}/${page.slug}`

    // Generate SEB config XML
    const examTitle = `${page.title} - ${page.skript.title}`
    const isDevelopment = process.env.NODE_ENV !== 'production'
    const sebConfigXml = generateSEBConfig(examUrl, examTitle, { isDevelopment })
    const filename = getSEBFilename(page.title)

    // SEB file format: "plnd" prefix (4 bytes) + gzip-compressed XML
    // See: https://safeexambrowser.org/developer/seb-file-format.html
    const compressedConfig = gzipSync(Buffer.from(sebConfigXml, 'utf-8'))
    const sebFile = Buffer.concat([Buffer.from('plnd', 'utf-8'), compressedConfig])

    // Return as downloadable .seb file
    return new NextResponse(sebFile, {
      status: 200,
      headers: {
        'Content-Type': getSEBMimeType(),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache'
      }
    })
  } catch (error) {
    console.error('Error generating SEB config:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
