/**
 * Tiny helper endpoint that bridges "I'm viewing a page with <Survey>" to
 * "this is the class ID where its responses live". Used by SurveyProvider on
 * the client to light up author-only UI (response counts, inline progress
 * bars, CSV link).
 *
 * Returns:
 *  - `isAuthor`: true when the viewer has edit rights on the page (via
 *    checkPagePermissions — inherits skript/collection authorship).
 *  - `implicitClassId`: the classId of the page's implicit survey class, or
 *    null if no respondent has submitted yet (the class is created lazily on
 *    first POST to /api/survey-responses).
 *  - `responseCount`: how many ClassMembership rows exist for the implicit
 *    class. Zero before first submission.
 *
 * Non-authors get `{isAuthor: false}` and no class info — don't leak the
 * pseudo-class id to anyone who isn't already entitled to see it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await params

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ isAuthor: false }, { status: 200 })
    }

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        authors: { include: { user: { select: { id: true } } } },
        skript: {
          include: {
            authors: { include: { user: { select: { id: true } } } },
            collectionSkripts: {
              include: {
                collection: {
                  include: {
                    authors: { include: { user: { select: { id: true } } } },
                  },
                },
              },
            },
          },
        },
        implicitSurveyClass: {
          select: {
            id: true,
            _count: { select: { memberships: true } },
          },
        },
      },
    })

    if (!page) {
      return NextResponse.json({ isAuthor: false }, { status: 200 })
    }

    const perms = checkPagePermissions(
      session.user.id,
      page.authors,
      page.skript.authors,
      session.user.isAdmin
    )

    if (!perms.canEdit) {
      return NextResponse.json({ isAuthor: false }, { status: 200 })
    }

    return NextResponse.json({
      isAuthor: true,
      implicitClassId: page.implicitSurveyClass?.id ?? null,
      responseCount: page.implicitSurveyClass?._count.memberships ?? 0,
    })
  } catch (err) {
    console.error('[API] survey-meta failed:', err)
    return NextResponse.json({ error: 'Failed to resolve survey meta' }, { status: 500 })
  }
}
