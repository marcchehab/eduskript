/**
 * The calling student's own grade + per-question breakdown for one exam —
 * available ONLY once the teacher has returned it. Serves the FROZEN snapshot from
 * the last return (so it matches exactly what /review shows the student; legacy
 * returns without a snapshot fall back to a live recompute). Powers the student
 * feedback view.
 *
 * GET /api/exams/[pageId]/my-grade
 *   404 if no submission; 403 if not currently returned.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeExamGrades } from '@/lib/scoring/aggregate'
import { getCurrentReturn } from '@/lib/scoring/return-state'

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

    // Return state is derived from the exam log (single source of truth).
    const [submission, ret] = await Promise.all([
      prisma.examSubmission.findUnique({
        where: { pageId_studentId: { pageId, studentId } },
        select: { submittedAt: true },
      }),
      getCurrentReturn(pageId, studentId),
    ])
    if (!submission) {
      return NextResponse.json({ error: 'No submission found' }, { status: 404 })
    }
    if (!ret?.returned) {
      return NextResponse.json({ error: 'Not returned yet' }, { status: 403 })
    }

    const page = await prisma.page.findUnique({ where: { id: pageId }, select: { title: true } })

    // Frozen snapshot from the last return. Legacy returns with no snapshot fall
    // back to a live recompute (matches /review's fallback).
    let grade: number, totalEarned: number, totalMax: number
    let components: { componentId: string; label: string | null; earned: number; max: number; answered: boolean }[]
    if (ret.snapshot) {
      const s = ret.snapshot
      grade = s.grade
      totalEarned = s.totalEarned
      totalMax = s.totalMax
      components = s.components.map((c) => ({
        componentId: c.componentId,
        label: c.label ?? null,
        earned: c.earned,
        max: c.max,
        answered: c.answered,
      }))
    } else {
      const grading = await computeExamGrades(pageId, [studentId])
      const g = grading.byStudent.get(studentId)!
      const labels = new Map(grading.components.map((c) => [c.componentId, c.label]))
      grade = g.grade
      totalEarned = g.totalEarned
      totalMax = g.totalMax
      components = g.components.map((c) => ({
        componentId: c.componentId,
        label: labels.get(c.componentId) ?? null,
        earned: c.earned,
        max: c.max,
        answered: c.answered,
      }))
    }

    return NextResponse.json({
      pageTitle: page?.title ?? 'Exam',
      submittedAt: submission.submittedAt,
      returnedAt: ret.at,
      grade,
      totalEarned,
      totalMax,
      components,
    })
  } catch (error) {
    console.error('[my-grade] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load grade' }, { status: 500 })
  }
}
