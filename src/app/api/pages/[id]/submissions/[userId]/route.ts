/**
 * Per-user submission wipe.
 *
 * DELETE /api/pages/[id]/submissions/[userId]?siteId=…
 *
 * Removes every "answer" the user has on this page — quiz responses, code
 * editor state, SQL attempts, python check counters, survey submissions,
 * survey-meta bookkeeping, plus any ExamSubmission row. Annotations, sticky
 * notes (`snaps`), and telemetry are preserved: those are markup or
 * instrumentation, not gradeable answers. The teacher's intent here is "let
 * this respondent answer fresh", not "scrub the page of every trace".
 *
 * Auth: managers of `siteId` (site scoping); only that site's rows are touched.
 *
 * No SSE event is fired — the affected respondent (often anonymous and
 * already off the page) doesn't need a live notification. The teacher's
 * toolbar refreshes from the response.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageSite } from '@/lib/site-access'

// Mirrors NON_ANSWER_ADAPTERS in the GET route. Anything in this list is
// preserved on delete. Keep the two lists in sync.
const PRESERVED_ADAPTERS = ['annotations', 'snaps', 'telemetry']

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: pageId, userId } = await params

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Site scoping: only the managers of the site the answers were given on
    // may wipe them (src/lib/site-access.ts). No admin bypass.
    const siteId = req.nextUrl.searchParams.get('siteId')
    if (!siteId || !(await canManageSite(session.user.id, siteId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const { count: userDataDeleted } = await tx.userData.deleteMany({
        where: {
          userId,
          siteId,
          itemId: pageId,
          adapter: { notIn: PRESERVED_ADAPTERS },
        },
      })

      const { count: examSubmissionsDeleted } = await tx.examSubmission.deleteMany({
        where: { pageId, studentId: userId, siteId },
      })

      return { userDataDeleted, examSubmissionsDeleted }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[API] page submission delete failed:', err)
    return NextResponse.json({ error: 'Failed to delete submission' }, { status: 500 })
  }
}
