/**
 * Latest server-side checkpoint per code-editor componentId for one student
 * on one page. Powers the teacher's "view this student's work" mode on the
 * exam page — one round-trip even when the page has many editors.
 *
 * GET /api/exams/[pageId]/student-snapshot?studentId=X&siteId=S
 *
 * Site scoping: a teacher must MANAGE the site of the student's attempt
 * (src/lib/scoring/site-scope.ts; siteId optional, resolved otherwise). A
 * student reading their own snapshot must name the site.
 * Returns `handin` when it exists; otherwise the most recent live checkpoint
 * (manual/check/run/auto). That keeps the same UI useful mid-exam (live
 * progress) and post-exam (frozen submission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { authorizeStudentSite } from '@/lib/scoring/site-scope'

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

    const searchParams = new URL(request.url).searchParams
    const studentId = searchParams.get('studentId')
    if (!studentId) {
      return NextResponse.json({ error: 'studentId required' }, { status: 400 })
    }

    // Self-read is allowed for symmetry, but the primary caller is the teacher.
    const isSelf = studentId === session.user.id
    const siteId = isSelf
      ? searchParams.get('siteId')
      : await authorizeStudentSite(session.user.id, pageId, studentId, searchParams.get('siteId'))
    if (!siteId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // distinct + orderBy returns the first row per componentId by the ordering.
    // Ordering by createdAt desc gives the latest checkpoint per componentId.
    // Prefilter to code-editor components so we don't drag in annotation/quiz
    // checkpoints — those have their own teacher-facing views.
    const rows = await prisma.userDataCheckpoint.findMany({
      where: {
        userId: studentId,
        pageId,
        siteId,
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

    // Fall back to the student's LIVE userData for any editor with no
    // checkpoint. With exam-mode streaming, a student who typed code but never
    // ran/checked/handed-in still has their work in userData (no checkpoint) —
    // without this the teacher sees default content. Mirrors check-inputs
    // (handin checkpoint preferred, else live userData).
    const liveRows = await prisma.userData.findMany({
      where: {
        userId: studentId,
        siteId,
        itemId: pageId,
        adapter: { startsWith: 'code-editor-' },
        targetType: null,
      },
      select: { adapter: true, data: true, updatedAt: true },
    })
    for (const row of liveRows) {
      if (snapshots[row.adapter]) continue // a checkpoint (run/check/handin) wins
      snapshots[row.adapter] = {
        componentId: row.adapter,
        kind: 'live',
        label: null,
        createdAt: row.updatedAt.toISOString(),
        payload: row.data,
      }
    }

    return NextResponse.json({ snapshots })
  } catch (error) {
    console.error('[student-snapshot] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch snapshot' }, { status: 500 })
  }
}
