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
import { computeExamGrades } from '@/lib/grading/aggregate'
import { isTeacherOfStudentForPage } from '@/lib/grading/auth'

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
      select: { submittedAt: true, returnedAt: true },
    })
    if (isSelf) {
      if (!submission?.returnedAt) {
        return NextResponse.json({ error: 'Not returned yet' }, { status: 403 })
      }
    } else if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const grading = await computeExamGrades(pageId, [studentId])
    const g = grading.byStudent.get(studentId)!
    const componentIds = grading.components.map((c) => c.componentId)

    // Stored answer payloads (the same UserData rows the engine scored from).
    const rows = componentIds.length
      ? await prisma.userData.findMany({
          where: { userId: studentId, itemId: pageId, adapter: { in: componentIds }, targetType: null },
          select: { adapter: true, data: true },
        })
      : []
    const payloadByComponent = new Map(rows.map((r) => [r.adapter, r.data]))

    return NextResponse.json({
      studentId,
      grade: g.grade,
      totalEarned: g.totalEarned,
      totalMax: g.totalMax,
      returnedAt: submission?.returnedAt ?? null,
      components: g.components.map((c) => ({
        componentId: c.componentId,
        kind: c.kind,
        questionType: c.questionType ?? null,
        label: c.label ?? null,
        earned: c.earned,
        max: c.max,
        autoEarned: c.autoEarned,
        answered: c.answered,
        overridden: c.overridden,
        feedback: c.feedback ?? null,
        answerPayload: payloadByComponent.get(c.componentId) ?? null,
      })),
    })
  } catch (error) {
    console.error('[review] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load review' }, { status: 500 })
  }
}
