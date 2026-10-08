/**
 * Return scored exams to students. Appends an append-only `return` event (with the
 * frozen score-payload) to the exam log and notifies the student via SSE so their
 * My Exams view updates. Teacher-only.
 *
 * POST /api/exams/[pageId]/grading/return
 * body: { studentId }              → return one student
 *       { all: true, classId }     → return every submitted student in the class
 *
 * Site scoping: caller must manage the site of each student's attempt
 * (src/lib/scoring/site-scope.ts); body.siteId optionally picks it.
 *
 * Only students who have actually submitted are returned (no submission row =
 * skipped). Re-returning APPENDS a new `return` event — prior returns and their
 * snapshots are preserved. Return state is derived from the log, never from a flag
 * on ExamSubmission. See src/lib/scoring/return-state.ts. Inverse: ./take-back.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { Prisma } from '@prisma/client'
import { buildReviewScores } from '@/lib/scoring/review-payload'
import { getExamScope, getGradingStudentIds, resolveStudentSite, resolveStudentSites } from '@/lib/scoring/site-scope'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { pageId } = await params
    const scope = await getExamScope(session.user.id, pageId)
    if (!scope) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))

    // Site scoping: each student is acted on for ONE managed site (their
    // resolved attempt site, or the explicit body.siteId for a single student).
    let studentSites: Map<string, string>
    if (body.all === true) {
      const ids = await getGradingStudentIds(scope, session.user.id, pageId, body.classId as string | undefined)
      if (!ids) {
        return NextResponse.json({ error: 'Not the teacher of this class' }, { status: 403 })
      }
      studentSites = await resolveStudentSites(pageId, ids, scope.siteIds)
    } else {
      const studentId = body.studentId as string | undefined
      if (!studentId) {
        return NextResponse.json({ error: 'studentId or all+classId is required' }, { status: 400 })
      }
      const siteId = await resolveStudentSite(scope, pageId, studentId, typeof body.siteId === 'string' ? body.siteId : null)
      if (!siteId) {
        return NextResponse.json({ error: 'You do not manage this site' }, { status: 403 })
      }
      studentSites = new Map([[studentId, siteId]])
    }
    const studentIds = [...studentSites.keys()]

    const submissions = await prisma.examSubmission.findMany({
      where: { pageId, studentId: { in: studentIds }, siteId: { in: [...new Set(studentSites.values())] } },
      select: { studentId: true, siteId: true },
    })
    const submittedIds = submissions
      .filter((s) => studentSites.get(s.studentId) === s.siteId)
      .map((s) => s.studentId)
    if (submittedIds.length === 0) {
      return NextResponse.json({ returned: 0, students: [] })
    }

    // Freeze each student's full review score-payload into an append-only `return`
    // event so the returned exam is an IMMUTABLE record. Re-returning appends a new
    // event (prior returns + their snapshots are preserved); later re-scores/rubric
    // edits only reach the student on a re-return. See review-payload.ts + return-state.ts.
    const snapshots = new Map(
      await Promise.all(submittedIds.map(async (sid) => [sid, await buildReviewScores(pageId, sid, studentSites.get(sid)!)] as const)),
    )
    const now = new Date()

    await prisma.$transaction(
      submittedIds.map((studentId) => {
        const snap = snapshots.get(studentId)!
        return prisma.examAuditLog.create({
          data: {
            pageId,
            studentId,
            siteId: studentSites.get(studentId)!,
            event: 'return',
            payload: snap as unknown as Prisma.InputJsonValue,
            score: snap.totalEarned,
            createdBy: session.user.id,
            occurredAt: now,
          },
        })
      }),
    )

    // Notify each student (fire-and-forget on the user channel).
    await Promise.all(
      submittedIds.map((studentId) =>
        eventBus.publish(`user:${studentId}`, {
          type: 'exam-returned',
          pageId,
          studentId,
          timestamp: now.getTime(),
        }),
      ),
    )

    return NextResponse.json({ returned: submittedIds.length, students: submittedIds })
  } catch (error) {
    console.error('[grading/return] POST failed:', error)
    return NextResponse.json({ error: 'Failed to return exams' }, { status: 500 })
  }
}
