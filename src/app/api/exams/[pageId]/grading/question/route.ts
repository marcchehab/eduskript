/**
 * Upsert (or clear) a teacher's per-question point override for one student.
 * Teacher-only (teaches a class containing the student with the page unlocked).
 *
 * PUT /api/exams/[pageId]/grading/question
 * body: { studentId, componentId, awardedPoints, maxPoints? }
 *   awardedPoints === null  → delete the override (revert to the auto score)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAuthoredExamPage, isTeacherOfStudentForPage } from '@/lib/grading/auth'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { pageId } = await params
    const body = await request.json().catch(() => ({}))
    const { studentId, componentId } = body as { studentId?: string; componentId?: string }
    if (!studentId || !componentId) {
      return NextResponse.json({ error: 'studentId and componentId are required' }, { status: 400 })
    }

    if (!(await getAuthoredExamPage(session.user.id, pageId))) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }
    if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
      return NextResponse.json({ error: 'Not the teacher of this student' }, { status: 403 })
    }

    // Clear the override → revert to the automatic score.
    if (body.awardedPoints === null) {
      await prisma.examQuestionGrade.deleteMany({ where: { pageId, studentId, componentId } })
      return NextResponse.json({ cleared: true })
    }

    const awardedPoints = Number(body.awardedPoints)
    if (!Number.isFinite(awardedPoints)) {
      return NextResponse.json({ error: 'awardedPoints must be a number or null' }, { status: 400 })
    }
    const maxPoints =
      body.maxPoints === null || body.maxPoints === undefined ? null : Number(body.maxPoints)

    const grade = await prisma.examQuestionGrade.upsert({
      where: { pageId_studentId_componentId: { pageId, studentId, componentId } },
      create: {
        pageId,
        studentId,
        componentId,
        awardedPoints,
        maxPoints: Number.isFinite(maxPoints as number) ? (maxPoints as number) : null,
        gradedBy: session.user.id,
      },
      update: {
        awardedPoints,
        maxPoints: Number.isFinite(maxPoints as number) ? (maxPoints as number) : null,
        gradedBy: session.user.id,
      },
    })

    return NextResponse.json({ grade })
  } catch (error) {
    console.error('[grading/question] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save question grade' }, { status: 500 })
  }
}
