/**
 * Exam Audit Log API
 *
 * GET /api/exams/[pageId]/audit?classId=xxx&siteId=yyy
 *
 * Returns the append-only event log (started / submitted / reopened) for
 * every student in the given class. Used by the teacher roster to compute
 * total time-on-exam across attempts and to render the per-student event
 * timeline tooltip.
 *
 * Same auth gating as `/api/exams/[pageId]/students`: caller must OWN the
 * personal site `siteId` (placing the page) AND teach the requested class.
 * Only that site's events are returned (site scoping).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSiteAccess, isItemPlacedOnSite } from '@/lib/site-access'

export type ExamAuditEvent = 'started' | 'submitted' | 'reopened'

export interface ExamAuditRow {
  event: ExamAuditEvent
  occurredAt: string // ISO timestamp
}

export interface ExamAuditResponse {
  /** Events keyed by studentId. Each list is oldest-first. */
  events: Record<string, ExamAuditRow[]>
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pageId } = await params
    const { searchParams } = new URL(request.url)
    const classId = searchParams.get('classId')
    const siteId = searchParams.get('siteId')

    if (!classId) {
      return NextResponse.json(
        { error: 'classId query parameter is required' },
        { status: 400 }
      )
    }

    // Site scoping: own personal site that places the page.
    const access = siteId ? await getSiteAccess(session.user.id, siteId) : null
    if (!siteId || !access?.isOwner || !(await isItemPlacedOnSite(pageId, siteId))) {
      return NextResponse.json(
        { error: 'Page not found or access denied' },
        { status: 404 }
      )
    }

    // Verify caller is the teacher of this class
    const classRecord = await prisma.class.findFirst({
      where: { id: classId, teacherId: session.user.id },
      select: { id: true },
    })

    if (!classRecord) {
      return NextResponse.json(
        { error: 'Class not found or you are not the teacher' },
        { status: 403 }
      )
    }

    // Restrict to students currently enrolled in the class — keeps the
    // payload bounded and avoids leaking events for unrelated students
    // who happened to have a row for this page in the past.
    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      select: { studentId: true },
    })
    const studentIds = memberships.map((m) => m.studentId)

    if (studentIds.length === 0) {
      const empty: ExamAuditResponse = { events: {} }
      return NextResponse.json(empty)
    }

    const rows = await prisma.examAuditLog.findMany({
      where: {
        pageId,
        siteId,
        studentId: { in: studentIds },
        // Attempt-lifecycle events only — the log now also holds grading events
        // (return / take_back), which must not leak into the duration roster.
        event: { in: ['started', 'submitted', 'reopened'] },
      },
      orderBy: { occurredAt: 'asc' },
      select: {
        studentId: true,
        event: true,
        occurredAt: true,
      },
    })

    const events: Record<string, ExamAuditRow[]> = {}
    for (const row of rows) {
      const list = events[row.studentId] ?? (events[row.studentId] = [])
      list.push({
        event: row.event as ExamAuditEvent,
        occurredAt: row.occurredAt.toISOString(),
      })
    }

    const body: ExamAuditResponse = { events }
    return NextResponse.json(body)
  } catch (error) {
    console.error('[API] Error fetching exam audit log:', error)
    return NextResponse.json(
      { error: 'Failed to fetch audit log' },
      { status: 500 }
    )
  }
}
