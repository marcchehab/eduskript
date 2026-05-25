/**
 * The calling student's own grade + per-question breakdown for one exam —
 * available ONLY once the teacher has returned it (returnedAt set). Powers the
 * student feedback view.
 *
 * GET /api/exams/[pageId]/my-grade
 *   404 if no submission; 403 if not yet returned.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeExamGrades } from '@/lib/grading/aggregate'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { pageId } = await params
    const studentId = session.user.id

    const submission = await prisma.examSubmission.findUnique({
      where: { pageId_studentId: { pageId, studentId } },
      select: { submittedAt: true, returnedAt: true },
    })
    if (!submission) {
      return NextResponse.json({ error: 'No submission found' }, { status: 404 })
    }
    if (!submission.returnedAt) {
      return NextResponse.json({ error: 'Not returned yet' }, { status: 403 })
    }

    const [page, grading] = await Promise.all([
      prisma.page.findUnique({ where: { id: pageId }, select: { title: true } }),
      computeExamGrades(pageId, [studentId]),
    ])
    const g = grading.byStudent.get(studentId)!
    const labels = new Map(grading.components.map((c) => [c.componentId, c.label]))

    return NextResponse.json({
      pageTitle: page?.title ?? 'Exam',
      submittedAt: submission.submittedAt,
      returnedAt: submission.returnedAt,
      grade: g.grade,
      totalEarned: g.totalEarned,
      totalMax: g.totalMax,
      components: g.components.map((c) => ({
        componentId: c.componentId,
        label: labels.get(c.componentId) ?? null,
        earned: c.earned,
        max: c.max,
        answered: c.answered,
      })),
    })
  } catch (error) {
    console.error('[my-grade] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load grade' }, { status: 500 })
  }
}
