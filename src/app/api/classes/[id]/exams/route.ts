/**
 * The exams of one class, for the teacher's class page: per exam how many members
 * handed in, how many of those are graded, how many are returned, plus a link to
 * the grading table. Teacher-only (class owner).
 *
 * GET /api/classes/[id]/exams
 *
 * Which exams: pages the teacher authors that are assigned to the class (a
 * class-level ExamState row) OR that a current member has submitted — the same
 * rule as getExamClassesForTeacher (lib/scoring/auth), seen from the class side.
 * Authorship is required because the grading page requires it.
 *
 * "graded" = handed in AND (a teacher override / AI score exists for any task, OR
 * currently returned). Auto-check scores alone don't count — they exist without
 * the teacher looking at anything. A heuristic, not a stored state.
 *
 * Cost: 4 queries + 1 return-state query and 1 URL lookup per exam (N small).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getExamUrl } from '@/lib/scoring/auth'
import { getCurrentReturnsForPage } from '@/lib/scoring/return-state'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true },
    })
    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    if (classRecord.teacherId !== userId) {
      return NextResponse.json({ error: 'You do not have permission to view this class' }, { status: 403 })
    }

    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      select: { studentId: true },
    })
    const memberIds = memberships.map((m) => m.studentId)

    const pages = await prisma.page.findMany({
      where: {
        authors: { some: { userId } },
        OR: [
          { examStates: { some: { classId, studentId: null } } },
          ...(memberIds.length > 0
            ? [{ examSubmissions: { some: { studentId: { in: memberIds } } } }]
            : []),
        ],
      },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    })
    if (pages.length === 0) {
      return NextResponse.json({ exams: [] })
    }
    const pageIds = pages.map((p) => p.id)

    const [submissions, teacherScores] = await Promise.all([
      prisma.examSubmission.findMany({
        where: { pageId: { in: pageIds }, studentId: { in: memberIds } },
        select: { pageId: true, studentId: true, submittedAt: true },
      }),
      prisma.componentScore.findMany({
        where: { pageId: { in: pageIds }, studentId: { in: memberIds }, source: { in: ['override', 'ai'] } },
        select: { pageId: true, studentId: true },
        distinct: ['pageId', 'studentId'],
      }),
    ])
    const scored = new Set(teacherScores.map((s) => `${s.pageId}:${s.studentId}`))

    const exams = await Promise.all(
      pages.map(async (page) => {
        const subs = submissions.filter((s) => s.pageId === page.id)
        const [returns, examUrl] = await Promise.all([
          getCurrentReturnsForPage(page.id, memberIds),
          getExamUrl(page.id),
        ])
        const isReturned = (studentId: string) => returns.get(studentId)?.returned === true
        const last = subs.reduce<Date | null>(
          (acc, s) => (acc && acc > s.submittedAt ? acc : s.submittedAt),
          null,
        )
        return {
          pageId: page.id,
          title: page.title,
          memberCount: memberIds.length,
          handedIn: subs.length,
          graded: subs.filter((s) => scored.has(`${page.id}:${s.studentId}`) || isReturned(s.studentId)).length,
          returned: subs.filter((s) => isReturned(s.studentId)).length,
          lastSubmittedAt: last,
          gradingUrl: `/dashboard/exams/${page.id}/grading?classId=${classId}`,
          examUrl,
        }
      }),
    )

    return NextResponse.json({ exams })
  } catch (error) {
    console.error('[classes/exams] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load exams' }, { status: 500 })
  }
}
