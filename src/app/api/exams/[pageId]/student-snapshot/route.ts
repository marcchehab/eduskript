/**
 * Latest server-side checkpoint per code-editor componentId for one student
 * on one page. Powers the teacher's "view this student's work" mode on the
 * exam page — one round-trip even when the page has many editors.
 *
 * GET /api/exams/[pageId]/student-snapshot?studentId=X
 *
 * Authorization matches /api/user-data/checkpoints/[id]: the caller must
 * teach a class containing the target student that has this page unlocked.
 * Returns `handin` when it exists; otherwise the most recent live checkpoint
 * (manual/check/run/auto). That keeps the same UI useful mid-exam (live
 * progress) and post-exam (frozen submission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ pageId: string }>
}

interface SnapshotEntry {
  componentId: string
  kind: string
  label: string | null
  createdAt: string
  payload: unknown
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { pageId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const studentId = new URL(request.url).searchParams.get('studentId')
    if (!studentId) {
      return NextResponse.json({ error: 'studentId required' }, { status: 400 })
    }

    // Self-read is allowed for symmetry, but the primary caller is the teacher.
    const isSelf = studentId === session.user.id
    if (!isSelf) {
      const allowed = await isTeacherOfStudentForPage(session.user.id, studentId, pageId)
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // distinct + orderBy returns the first row per componentId by the ordering.
    // Ordering by createdAt desc gives the latest checkpoint per componentId.
    // Prefilter to code-editor components so we don't drag in annotation/quiz
    // checkpoints — those have their own teacher-facing views.
    const rows = await prisma.userDataCheckpoint.findMany({
      where: {
        userId: studentId,
        pageId,
        componentId: { startsWith: 'code-editor-' },
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['componentId'],
      select: {
        componentId: true,
        kind: true,
        label: true,
        createdAt: true,
        payload: true,
      },
    })

    const snapshots: Record<string, SnapshotEntry> = {}
    for (const row of rows) {
      snapshots[row.componentId] = {
        componentId: row.componentId,
        kind: row.kind,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        payload: row.payload,
      }
    }

    return NextResponse.json({ snapshots })
  } catch (error) {
    console.error('[student-snapshot] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch snapshot' }, { status: 500 })
  }
}

async function isTeacherOfStudentForPage(
  viewerId: string,
  studentId: string,
  pageId: string
): Promise<boolean> {
  const membership = await prisma.classMembership.findFirst({
    where: {
      studentId,
      class: {
        teacherId: viewerId,
        pageUnlocks: { some: { pageId } },
      },
    },
    select: { id: true },
  })
  return Boolean(membership)
}
