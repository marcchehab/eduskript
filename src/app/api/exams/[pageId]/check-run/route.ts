/**
 * Persist an authoritative python re-run result computed on the teacher's
 * device, as a ComponentScore(source="check"). This is the "check score" the
 * scoring engine reads for the component (the highest-priority source with
 * points still wins overall — an override or AI score can outrank it).
 *
 * PUT /api/exams/[pageId]/check-run   (teacher-of-student only)
 * body: { studentId, componentId, earned, max, passed, total }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isTeacherOfStudentForPage } from '@/lib/scoring/auth'
import { SCORE_PRIORITY } from '@/lib/scoring/score-component'

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
      return NextResponse.json({ error: 'studentId and componentId required' }, { status: 400 })
    }
    if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const earned = Number(body.earned)
    const max = Number(body.max)
    const passed = Number(body.passed)
    const total = Number(body.total)
    if ([earned, max, passed, total].some((n) => !Number.isFinite(n))) {
      return NextResponse.json({ error: 'earned/max/passed/total must be numbers' }, { status: 400 })
    }

    const data = {
      priority: SCORE_PRIORITY.check,
      earned,
      max,
      meta: { passed, total },
      createdBy: session.user.id,
    }
    const run = await prisma.componentScore.upsert({
      where: {
        pageId_studentId_componentId_source: { pageId, studentId, componentId, source: 'check' },
      },
      create: { pageId, studentId, componentId, source: 'check', ...data },
      update: data,
    })
    return NextResponse.json({ run })
  } catch (error) {
    console.error('[check-run] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save check run' }, { status: 500 })
  }
}
