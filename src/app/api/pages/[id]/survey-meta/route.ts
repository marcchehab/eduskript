/**
 * Tiny helper endpoint that bridges "I'm viewing a page with <Survey>" to
 * "this is the class ID where its responses live". Used by SurveyProvider on
 * the client to light up manager-only UI (response counts, inline progress
 * bars, CSV link).
 *
 * GET /api/pages/[id]/survey-meta?siteId=…
 *
 * Returns:
 *  - `isAuthor`: true when the viewer MANAGES the site (personal owner / org
 *    owner+admin — site scoping, src/lib/site-access.ts). Name kept for the
 *    client; page authorship grants nothing, no superadmin bypass.
 *  - `implicitClassId`: the classId of the page's implicit survey class, or
 *    null if no respondent has submitted yet (the class is created lazily on
 *    first POST to /api/survey-responses). The class is per page and shared
 *    by every site; per-site filtering happens in the reading routes.
 *  - `responseCount`: respondents with at least one answer ON THIS SITE.
 *
 * Non-managers get `{isAuthor: false}` and no class info — don't leak the
 * pseudo-class id to anyone who isn't already entitled to see it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageSite } from '@/lib/site-access'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await params
    const siteId = req.nextUrl.searchParams.get('siteId')

    const session = await getServerSession(authOptions)
    if (!session?.user?.id || !siteId) {
      return NextResponse.json({ isAuthor: false }, { status: 200 })
    }

    if (!(await canManageSite(session.user.id, siteId))) {
      return NextResponse.json({ isAuthor: false }, { status: 200 })
    }

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { implicitSurveyClass: { select: { id: true } } },
    })

    if (!page) {
      return NextResponse.json({ isAuthor: false }, { status: 200 })
    }

    const implicitClassId = page.implicitSurveyClass?.id ?? null
    const responders = implicitClassId
      ? await prisma.userData.findMany({
          where: {
            siteId,
            itemId: pageId,
            adapter: { startsWith: 'quiz-' },
            user: { studentMemberships: { some: { classId: implicitClassId } } },
          },
          select: { userId: true },
          distinct: ['userId'],
        })
      : []

    return NextResponse.json({
      isAuthor: true,
      implicitClassId,
      responseCount: responders.length,
    })
  } catch (err) {
    console.error('[API] survey-meta failed:', err)
    return NextResponse.json({ error: 'Failed to resolve survey meta' }, { status: 500 })
  }
}
