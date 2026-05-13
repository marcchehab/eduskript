import { NextRequest, NextResponse } from 'next/server'
import { gzipSync } from 'zlib'
import { prisma } from '@/lib/prisma'
import { generateSEBConfig, getSEBMimeType, getSEBFilename } from '@/lib/seb'
import { generateExamToken } from '@/lib/exam-tokens'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/exams/[pageId]/seb-config
 * Download SEB configuration file for an exam page
 *
 * Authentication options:
 * 1. Session cookie (when downloading from regular browser)
 * 2. download_token query param (when SEB fetches via sebs:// protocol)
 *
 * A one-time exam token is embedded in the startURL so the user doesn't need to
 * log in again inside SEB.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params
    const searchParams = request.nextUrl.searchParams
    const downloadToken = searchParams.get('download_token')

    let userId: string | null = null

    // Try session auth first (regular browser with cookies)
    const session = await getServerSession(authOptions)
    if (session?.user?.id) {
      userId = session.user.id
    }

    // If no session, try download token (SEB fetching via sebs:// protocol)
    // Non-consuming: SEB may make multiple requests (preflight, retry, redirect)
    // so we can't invalidate the token on first use here. The seb_token embedded
    // in the config (for actual exam access) remains one-time use.
    if (!userId && downloadToken) {
      const { validateExamToken } = await import('@/lib/exam-tokens')
      userId = await validateExamToken(downloadToken, pageId, false)
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'You must be logged in to download the SEB configuration' },
        { status: 401 }
      )
    }

    // Get page with skript info
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

    // Get the teacher (first author) to build the exam URL. The teacher's URL
    // slug lives on Site now — look it up alongside the user.
    const teacher = page.skript.authors[0]?.user
    const collectionSkript = page.skript.collectionSkripts[0]

    const teacherSite = teacher
      ? await prisma.site.findUnique({
          where: { userId: teacher.id },
          select: { slug: true },
        })
      : null
    if (!teacherSite?.slug || !collectionSkript?.collection) {
      return NextResponse.json({ error: 'Invalid exam configuration' }, { status: 400 })
    }

    // Build the exam URL - use https for all external hosts, http only for localhost
    // URL structure: /org/{orgSlug}/{teacherPageSlug}/{skriptSlug}/{pageSlug}
    const host = request.headers.get('host') || 'eduskript.org'
    const protocol = host.startsWith('localhost') ? 'http' : 'https'
    const orgSlug = process.env.DEFAULT_ORG_SLUG || 'eduskript'
    const baseExamUrl = `${protocol}://${host}/org/${orgSlug}/${teacherSite.slug}/${page.skript.slug}/${page.slug}`

    // Generate one-time token for SEB authentication
    // This allows the user to be authenticated inside SEB without logging in again
    const { token } = await generateExamToken(userId, pageId)
    const examUrl = `${baseExamUrl}?seb_token=${token}`

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
