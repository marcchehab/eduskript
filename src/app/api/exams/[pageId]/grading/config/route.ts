/**
 * Upsert the grade key (formula + parameters) for an exam page. Teacher-only
 * (page author). One config per page.
 *
 * PUT /api/exams/[pageId]/grading/config
 * body: { formula, passPercent, passGrade, topGrade, bottomGrade, roundingStep, maxPoints }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAuthoredExamPage } from '@/lib/grading/auth'

function numOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

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
    if (!(await getAuthoredExamPage(session.user.id, pageId))) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const formula = body.formula === 'linear' ? 'linear' : 'twoSegment'
    const passPercent = Math.min(100, Math.max(0, numOr(body.passPercent, 60)))
    const passGrade = numOr(body.passGrade, 4)
    const topGrade = numOr(body.topGrade, 6)
    const bottomGrade = numOr(body.bottomGrade, 1)
    const roundingStep = numOr(body.roundingStep, 0.1)
    // null = auto-sum from components; a positive number caps the max.
    const maxPoints =
      body.maxPoints === null || body.maxPoints === undefined || body.maxPoints === ''
        ? null
        : numOr(body.maxPoints, 0) || null

    const data = {
      formula,
      passPercent,
      passGrade,
      topGrade,
      bottomGrade,
      roundingStep,
      maxPoints,
      updatedBy: session.user.id,
    }
    const config = await prisma.examGradeConfig.upsert({
      where: { pageId },
      create: { pageId, ...data },
      update: data,
    })

    return NextResponse.json({ config })
  } catch (error) {
    console.error('[grading/config] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save grade config' }, { status: 500 })
  }
}
