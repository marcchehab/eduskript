/**
 * All saved snapshots (checkpoints) for ONE student + ONE code-editor component,
 * newest first — so a teacher viewing a student can step through their history
 * (hand-in, checks, runs, manual saves) instead of only the latest. Teacher-only.
 *
 * GET /api/exams/[pageId]/component-snapshots?studentId=X&componentId=code-editor-Y
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
    const url = new URL(request.url)
    const studentId = url.searchParams.get('studentId')
    const componentId = url.searchParams.get('componentId')
    if (!studentId || !componentId) {
      return NextResponse.json({ error: 'studentId and componentId required' }, { status: 400 })
    }
    if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = await prisma.userDataCheckpoint.findMany({
      where: { userId: studentId, pageId, componentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, kind: true, label: true, createdAt: true, payload: true },
    })

    return NextResponse.json({
      snapshots: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        createdAt: r.createdAt.toISOString(),
        payload: r.payload,
      })),
    })
  } catch (error) {
    console.error('[component-snapshots] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load snapshots' }, { status: 500 })
  }
}
