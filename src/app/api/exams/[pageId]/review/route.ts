/**
 * Per-component answers + scores for reviewing one student's exam IN the exam
 * view — used both by the teacher (grading any student) and the student
 * (reviewing their own returned exam). One round-trip: the grade breakdown plus
 * each component's stored answer payload (so the teacher sees what the student
 * wrote without N fetches).
 *
 * GET /api/exams/[pageId]/review?studentId=X
 *   teacher: any student in a class they teach with the page unlocked.
 *   student: only themselves, and only once the exam is returned.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildReviewScores, type ReviewScores } from '@/lib/scoring/review-payload'
import { isTeacherOfStudentForPage } from '@/lib/scoring/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { pageId } = await params
    const requested = new URL(request.url).searchParams.get('studentId')
    const studentId = requested || session.user.id
    const isSelf = studentId === session.user.id

    // Authorize + (for self) require the exam to be returned.
    const submission = await prisma.examSubmission.findUnique({
      where: { pageId_studentId: { pageId, studentId } },
      select: { returnedAt: true, gradeSnapshot: true },
    })
    if (isSelf) {
      if (!submission?.returnedAt) {
        return NextResponse.json({ error: 'Not returned yet' }, { status: 403 })
      }
    } else if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // A returned exam viewed by the STUDENT serves the FROZEN snapshot taken at
    // return time (immutable record — re-scores/rubric edits don't leak in). The
    // teacher (live grading) and any legacy return without a snapshot use the live
    // scores. Answers are immutable post-submission, so they're always live.
    const scores: ReviewScores =
      isSelf && submission?.returnedAt && submission.gradeSnapshot
        ? (submission.gradeSnapshot as unknown as ReviewScores)
        : await buildReviewScores(pageId, studentId)
    const componentIds = scores.components.map((c) => c.componentId)

    const rows = componentIds.length
      ? await prisma.userData.findMany({
          where: { userId: studentId, itemId: pageId, adapter: { in: componentIds }, targetType: null },
          select: { adapter: true, data: true },
        })
      : []
    const payloadByComponent = new Map(rows.map((r) => [r.adapter, r.data]))

    return NextResponse.json({
      studentId,
      grade: scores.grade,
      totalEarned: scores.totalEarned,
      totalMax: scores.totalMax,
      returnedAt: submission?.returnedAt ?? null,
      components: scores.components.map((c) => ({
        ...c,
        answerPayload: payloadByComponent.get(c.componentId) ?? null,
      })),
    })
  } catch (error) {
    console.error('[review] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load review' }, { status: 500 })
  }
}
