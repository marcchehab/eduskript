/**
 * Persist an authoritative python re-run result (ExamCheckRun) computed on the
 * teacher's device. This is what the grading engine reads for the component.
 *
 * PUT /api/exams/[pageId]/check-run   (teacher-of-student only)
 * body: { studentId, componentId, earned, max, passed, total }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isTeacherOfStudentForPage } from '@/lib/grading/auth'

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

    const data = { earned, max, passed, total, ranBy: session.user.id, ranAt: new Date() }
    const run = await prisma.examCheckRun.upsert({
      where: { pageId_studentId_componentId: { pageId, studentId, componentId } },
      create: { pageId, studentId, componentId, ...data },
      update: data,
    })
    return NextResponse.json({ run })
  } catch (error) {
    console.error('[check-run] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to save check run' }, { status: 500 })
  }
}
