/**
 * Exam State API Route — the single writer for the exam lifecycle.
 *
 * Manages exam state per class, with optional per-student overrides:
 * - GET: retrieve exam state for a class (optionally a student override)
 * - POST: set state (teacher only)
 *
 * States (teachers can freely switch between any):
 * - "hidden": Not assigned — no ExamState row. Not in the class sidebar, no entry.
 * - "closed": Assigned/visible, but students cannot enter yet.
 * - "lobby":  Students can enter but see the waiting room until opened.
 * - "open":   Students can take the exam.
 *
 * Setting "hidden" deletes the row (un-assign). A row with studentId set is a
 * per-student override that wins over the class row — see lib/exam-state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { EXAM_STATES, type ExamLifecycleState } from '@/lib/exam-state'

/**
 * GET /api/exams/[pageId]/state?classId=xxx[&studentId=yyy]
 * Get exam state for a class (or a specific student override within it).
 * Accessible by: teacher (page author) or students in the class.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params
    const { searchParams } = new URL(request.url)
    const classId = searchParams.get('classId')
    const studentId = searchParams.get('studentId')

    if (!classId) {
      return NextResponse.json(
        { error: 'classId query parameter is required' },
        { status: 400 }
      )
    }

    const examState = await prisma.examState.findFirst({
      where: { pageId, classId, studentId: studentId ?? null },
      include: { class: { select: { id: true, name: true } } },
    })

    if (!examState) {
      // No row == hidden (not assigned for this class/student).
      return NextResponse.json({
        state: 'hidden',
        message: 'Exam not assigned for this class',
      })
    }

    return NextResponse.json({
      id: examState.id,
      state: examState.state,
      openedAt: examState.openedAt,
      closedAt: examState.closedAt,
      className: examState.class.name,
    })
  } catch (error) {
    console.error('Error fetching exam state:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/exams/[pageId]/state
 * Body: { classId: string, studentId?: string, state: "hidden"|"closed"|"lobby"|"open" }
 * Only accessible by page authors who are also the class teacher.
 * "hidden" deletes the row (un-assign). studentId set = per-student override.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pageId } = await params
    const body = await request.json()
    const classId = body.classId as string | undefined
    const studentId = (body.studentId as string | undefined) ?? null
    const newState = body.state as ExamLifecycleState | undefined

    if (!classId || !newState) {
      return NextResponse.json({ error: 'classId and state are required' }, { status: 400 })
    }
    if (!EXAM_STATES.includes(newState)) {
      return NextResponse.json(
        { error: 'state must be "hidden", "closed", "lobby", or "open"' },
        { status: 400 }
      )
    }

    // Verify user is a page author.
    const page = await prisma.page.findFirst({
      where: { id: pageId, authors: { some: { userId: session.user.id } } },
      select: { id: true },
    })
    if (!page) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    // Verify user is the teacher of this class.
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

    // A per-student override must target a member of the class.
    if (studentId) {
      const member = await prisma.classMembership.findFirst({
        where: { classId, studentId },
        select: { id: true },
      })
      if (!member) {
        return NextResponse.json({ error: 'Student is not a member of this class' }, { status: 400 })
      }
    }

    const existing = await prisma.examState.findFirst({
      where: { pageId, classId, studentId },
      select: { id: true, state: true, openedAt: true, closedAt: true },
    })

    // "hidden" == un-assign: remove the row entirely (no row means hidden).
    if (newState === 'hidden') {
      if (existing) await prisma.examState.delete({ where: { id: existing.id } })
      await emitStateChange(pageId, classId, studentId, 'hidden')
      return NextResponse.json({ state: 'hidden' })
    }

    // Track open/close timestamps across transitions.
    let openedAt: Date | null = existing?.openedAt ?? null
    let closedAt: Date | null = existing?.closedAt ?? null
    if (newState === 'open' && existing?.state !== 'open') {
      openedAt = new Date()
      closedAt = null
    } else if (newState !== 'open' && existing?.state === 'open') {
      closedAt = new Date()
    }

    const saved = existing
      ? await prisma.examState.update({
          where: { id: existing.id },
          data: { state: newState, openedAt, closedAt },
          include: { class: { select: { id: true, name: true } } },
        })
      : await prisma.examState.create({
          data: { pageId, classId, studentId, state: newState, openedAt, closedAt },
          include: { class: { select: { id: true, name: true } } },
        })

    await emitStateChange(pageId, classId, studentId, newState)

    return NextResponse.json({
      id: saved.id,
      state: saved.state,
      openedAt: saved.openedAt,
      closedAt: saved.closedAt,
      className: saved.class.name,
    })
  } catch (error) {
    console.error('Error updating exam state:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** SSE for the waiting room. Per-student overrides also broadcast on the class
 *  channel (carrying studentId) so a student-targeted change can be filtered
 *  client-side. */
async function emitStateChange(
  pageId: string,
  classId: string,
  studentId: string | null,
  state: ExamLifecycleState,
) {
  await eventBus.publish(`exam:${pageId}:${classId}`, {
    type: 'exam-state-change',
    pageId,
    classId,
    studentId,
    state,
    timestamp: Date.now(),
  })
}
