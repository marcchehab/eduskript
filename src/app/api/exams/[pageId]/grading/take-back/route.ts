/**
 * Take back a returned exam — the explicit, NON-destructive un-return a teacher
 * must perform before correcting a returned student's score. Appends a `take_back`
 * event to the exam log (so the student is no longer "currently returned") and
 * notifies the student via SSE so their grade hides until it's re-returned.
 * Teacher-only. Inverse of ./return.
 *
 * POST /api/exams/[pageId]/grading/take-back
 * body: { studentId }            → take back one student
 *       { all: true, classId }   → take back every currently-returned student in the class
 *
 * NON-DESTRUCTIVE: ComponentScore rows and every prior `return` snapshot survive
 * (unlike ./../students reopen, which deletes the submission). Only currently-
 * returned students are affected; others are skipped. See return-state.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { getExamScope, getGradingStudentIds, resolveStudentSite, resolveStudentSites } from '@/lib/scoring/site-scope'
import { getCurrentReturnsForPage } from '@/lib/scoring/return-state'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { pageId } = await params
    const scope = await getExamScope(session.user.id, pageId)
    if (!scope) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))

    // Site scoping: each student is acted on for ONE managed site (their
    // resolved attempt site, or the explicit body.siteId for a single student).
    let studentSites: Map<string, string>
    if (body.all === true) {
      const ids = await getGradingStudentIds(scope, session.user.id, pageId, body.classId as string | undefined)
      if (!ids) {
        return NextResponse.json({ error: 'Not the teacher of this class' }, { status: 403 })
      }
      studentSites = await resolveStudentSites(pageId, ids, scope.siteIds)
    } else {
      const studentId = body.studentId as string | undefined
      if (!studentId) {
        return NextResponse.json({ error: 'studentId or all+classId is required' }, { status: 400 })
      }
      const siteId = await resolveStudentSite(scope, pageId, studentId, typeof body.siteId === 'string' ? body.siteId : null)
      if (!siteId) {
        return NextResponse.json({ error: 'You do not manage this site' }, { status: 403 })
      }
      studentSites = new Map([[studentId, siteId]])
    }
    const studentIds = [...studentSites.keys()]

    const returns = await getCurrentReturnsForPage(pageId, studentSites)
    const returnedIds = studentIds.filter((id) => returns.get(id)?.returned)
    if (returnedIds.length === 0) {
      return NextResponse.json({ takenBack: 0, students: [] })
    }

    const now = new Date()
    await prisma.$transaction(
      returnedIds.map((studentId) =>
        prisma.examAuditLog.create({
          data: { pageId, studentId, siteId: studentSites.get(studentId)!, event: 'take_back', createdBy: session.user.id, occurredAt: now },
        }),
      ),
    )

    // Notify each student (fire-and-forget) so their grade hides.
    await Promise.all(
      returnedIds.map((studentId) =>
        eventBus.publish(`user:${studentId}`, {
          type: 'exam-taken-back',
          pageId,
          studentId,
          timestamp: now.getTime(),
        }),
      ),
    )

    return NextResponse.json({ takenBack: returnedIds.length, students: returnedIds })
  } catch (error) {
    console.error('[grading/take-back] POST failed:', error)
    return NextResponse.json({ error: 'Failed to take back exams' }, { status: 500 })
  }
}
