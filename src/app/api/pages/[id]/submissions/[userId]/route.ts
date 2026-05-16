/**
 * Per-user submission wipe.
 *
 * DELETE /api/pages/[id]/submissions/[userId]
 *
 * Removes every "answer" the user has on this page — quiz responses, code
 * editor state, SQL attempts, python check counters, survey submissions,
 * survey-meta bookkeeping, plus any ExamSubmission row. Annotations, sticky
 * notes (`snaps`), and telemetry are preserved: those are markup or
 * instrumentation, not gradeable answers. The teacher's intent here is "let
 * this respondent answer fresh", not "scrub the page of every trace".
 *
 * Auth: page authors only.
 *
 * No SSE event is fired — the affected respondent (often anonymous and
 * already off the page) doesn't need a live notification. The teacher's
 * toolbar refreshes from the response.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'

// Mirrors NON_ANSWER_ADAPTERS in the GET route. Anything in this list is
// preserved on delete. Keep the two lists in sync.
const PRESERVED_ADAPTERS = ['annotations', 'snaps', 'telemetry']

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: pageId, userId } = await params

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        authors: { include: { user: { select: { id: true } } } },
        skript: {
          include: {
            authors: { include: { user: { select: { id: true } } } },
          },
        },
      },
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    const perms = checkPagePermissions(
      session.user.id,
      page.authors,
      page.skript.authors,
      session.user.isAdmin
    )

    if (!perms.canEdit) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const { count: userDataDeleted } = await tx.userData.deleteMany({
        where: {
          userId,
          itemId: pageId,
          adapter: { notIn: PRESERVED_ADAPTERS },
        },
      })

      const { count: examSubmissionsDeleted } = await tx.examSubmission.deleteMany({
        where: { pageId, studentId: userId },
      })

      return { userDataDeleted, examSubmissionsDeleted }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[API] page submission delete failed:', err)
    return NextResponse.json({ error: 'Failed to delete submission' }, { status: 500 })
  }
}
