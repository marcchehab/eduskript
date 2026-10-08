import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSEBConfig, getSEBMimeType, getSEBFilename } from '@/lib/seb'
import { encodeSEBFile } from '@/lib/seb-file'
import { generateExamToken } from '@/lib/exam-tokens'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isItemPlacedOnSite } from '@/lib/site-access'

/**
 * GET /api/exams/[pageId]/seb-config?siteId=…
 * Download SEB configuration file for an exam page on one (personal) site
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

    // Site scoping: the start URL points at the site the student is on (the
    // client passes its current site), not the first author's primary site.
    const siteId = searchParams.get('siteId')
    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }
    const [page, site] = await Promise.all([
      prisma.page.findFirst({
        where: { id: pageId, pageType: 'exam' }, // Only serve config for exam pages
        include: { skript: { select: { slug: true, title: true } } },
      }),
      prisma.site.findUnique({ where: { id: siteId }, select: { slug: true, organizationId: true } }),
    ])

    if (!page) {
      return NextResponse.json({ error: 'Exam page not found' }, { status: 404 })
    }
    // Only personal sites have the /exam route; the exam must be placed there.
    if (!site || site.organizationId || !(await isItemPlacedOnSite(pageId, siteId))) {
      return NextResponse.json({ error: 'Invalid exam configuration' }, { status: 400 })
    }

    // Build the exam URL - use https for all external hosts, http only for localhost
    // Point straight at /exam/{siteSlug}/{skriptSlug}/{pageSlug}: the /org/... content
    // route is ISR and redirects exam pages there WITHOUT the query string, which
    // dropped seb_token (student landed logged out on "Exam locked").
    const host = request.headers.get('host') || 'eduskript.org'
    const protocol = host.startsWith('localhost') ? 'http' : 'https'
    const baseExamUrl = `${protocol}://${host}/exam/${site.slug}/${page.skript.slug}/${page.slug}`

    // Generate one-time token for SEB authentication
    // This allows the user to be authenticated inside SEB without logging in again
    const { token } = await generateExamToken(userId, pageId)
    const examUrl = `${baseExamUrl}?seb_token=${token}`

    // Generate SEB config XML
    const examTitle = `${page.title} - ${page.skript.title}`
    const isDevelopment = process.env.NODE_ENV !== 'production'
    const sebConfigXml = generateSEBConfig(examUrl, examTitle, { isDevelopment })
    const filename = getSEBFilename(page.title)
    const sebFile = encodeSEBFile(sebConfigXml)

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
