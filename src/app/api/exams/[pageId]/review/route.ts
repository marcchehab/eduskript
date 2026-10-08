/**
 * Per-component answers + scores for reviewing one student's exam IN the exam
 * view — used both by the teacher (grading any student) and the student
 * (reviewing their own returned exam). One round-trip: the grade breakdown plus
 * each component's stored answer payload (so the teacher sees what the student
 * wrote without N fetches).
 *
 * GET /api/exams/[pageId]/review?studentId=X[&siteId=S]
 *   teacher: any student whose data lives on a site the teacher MANAGES (site
 *            scoping — src/lib/scoring/site-scope.ts; authorship grants
 *            nothing). siteId optional: picks which managed site's attempt.
 *   student: only themselves, only once returned; siteId required.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildReviewScores, type ReviewScores } from '@/lib/scoring/review-payload'
import { getExamScope, resolveStudentSite } from '@/lib/scoring/site-scope'
import { getCurrentReturn, examHasReturnedStudent } from '@/lib/scoring/return-state'

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
    const searchParams = new URL(request.url).searchParams
    const requested = searchParams.get('studentId')
    const requestedSite = searchParams.get('siteId')
    const studentId = requested || session.user.id
    const isSelf = studentId === session.user.id

    // Resolve the site: the student's own view names it; a teacher's must be
    // one of their managed sites (explicit, or the student's resolved site).
    let siteId: string | null
    if (isSelf) {
      siteId = requestedSite
    } else {
      const scope = await getExamScope(session.user.id, pageId)
      siteId = scope ? await resolveStudentSite(scope, pageId, studentId, requestedSite) : null
    }
    if (!siteId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Authorize + (for self) require the exam to be CURRENTLY returned. Return state
    // is derived from the exam log (single source of truth). See return-state.ts.
    const ret = await getCurrentReturn(pageId, studentId, siteId)
    if (isSelf && !ret?.returned) {
      return NextResponse.json({ error: 'Not returned yet' }, { status: 403 })
    }

    // A returned exam viewed by the STUDENT serves the FROZEN snapshot from the last
    // return (immutable record — re-scores/rubric edits don't leak in). The teacher
    // (live grading) and any return without a snapshot use the live scores. Answers
    // are immutable post-submission, so they're always live.
    const scores: ReviewScores =
      isSelf && ret?.returned && ret.snapshot
        ? ret.snapshot
        : await buildReviewScores(pageId, studentId, siteId)
    const componentIds = scores.components.map((c) => c.componentId)

    const rows = componentIds.length
      ? await prisma.userData.findMany({
          where: { userId: studentId, siteId, itemId: pageId, adapter: { in: componentIds }, targetType: null },
          select: { adapter: true, data: true },
        })
      : []
    const payloadByComponent = new Map(rows.map((r) => [r.adapter, r.data]))

    return NextResponse.json({
      studentId,
      siteId,
      grade: scores.grade,
      totalEarned: scores.totalEarned,
      totalMax: scores.totalMax,
      returnedAt: ret?.returned ? ret.at : null,
      // Lock flags for the in-exam grading UI: per-student (this student returned?)
      // and exam-level (any student returned → rubric locked). Only the teacher view
      // needs the exam-level flag.
      returnedToStudent: ret?.returned ?? false,
      examHasReturned: isSelf ? false : await examHasReturnedStudent(pageId),
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
