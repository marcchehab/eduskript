/**
 * Upsert (or clear) a teacher's per-question point override for one student.
 * Teacher-only (teaches a class containing the student with the page unlocked).
 *
 * PUT /api/exams/[pageId]/grading/question
 * body: { studentId, componentId, awardedPoints?, maxPoints?, feedback? }
 *
 * A row carries an optional points override AND optional written feedback,
 * independently. Each field is updated only if its KEY is present in the body
 * (partial merge), so the points UI and the feedback UI can save separately:
 *   - awardedPoints: number → set the points override; null → clear it (auto)
 *   - feedback: string → set feedback; null/'' → clear it
 * The row is deleted once BOTH the points override and feedback are empty.
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

    const existing = await prisma.examQuestionGrade.findUnique({
      where: { pageId_studentId_componentId: { pageId, studentId, componentId } },
      select: { awardedPoints: true, maxPoints: true, feedback: true },
    })

    // Partial merge: only fields whose key is present in the body change.
    const hasPoints = 'awardedPoints' in body
    const hasFeedback = 'feedback' in body
    const hasMax = 'maxPoints' in body

    let awardedPoints: number | null = existing?.awardedPoints ?? null
    if (hasPoints) {
      if (body.awardedPoints === null) {
        awardedPoints = null
      } else {
        const n = Number(body.awardedPoints)
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: 'awardedPoints must be a number or null' }, { status: 400 })
        }
        awardedPoints = n
      }
    }

    let feedback: string | null = existing?.feedback ?? null
    if (hasFeedback) {
      const f = typeof body.feedback === 'string' ? body.feedback.trim() : ''
      feedback = f === '' ? null : f
    }

    let maxPoints: number | null = existing?.maxPoints ?? null
    if (hasMax) {
      maxPoints = body.maxPoints === null ? null : Number(body.maxPoints)
      if (maxPoints !== null && !Number.isFinite(maxPoints)) maxPoints = null
    }

    // Nothing left to store → drop the row (reverts to the auto score).
    if (awardedPoints === null && feedback === null) {
      await prisma.examQuestionGrade.deleteMany({ where: { pageId, studentId, componentId } })
      return NextResponse.json({ cleared: true })
    }

    const grade = await prisma.examQuestionGrade.upsert({
      where: { pageId_studentId_componentId: { pageId, studentId, componentId } },
      create: { pageId, studentId, componentId, awardedPoints, maxPoints, feedback, gradedBy: session.user.id },
      update: { awardedPoints, maxPoints, feedback, gradedBy: session.user.id },
    })

    return NextResponse.json({ grade })
  } catch (error) {
    console.error('[grading/question] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save question grade' }, { status: 500 })
  }
}
