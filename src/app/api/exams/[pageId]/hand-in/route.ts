/**
 * Exam Hand-In API Route
 *
 * Records when a student submits their exam.
 * After hand-in, the student's exam session is ended.
 *
 * Flow:
 * 1. Student clicks "Hand in & Quit"
 * 2. Frontend shows confirmation dialog
 * 3. POST to this endpoint to record submission
 * 4. Frontend navigates to /api/exams/end-session to clear cookie
 * 5. SEB navigates to quitURL, ending the session
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { validateExamSession, ExamSessionData } from '@/lib/exam-tokens'
import { eventBus } from '@/lib/events'
import { applyHandinSnapshots, type HandinSnapshot } from '@/lib/exam-recovery'

/**
 * POST /api/exams/[pageId]/hand-in
 * Record exam submission for the current student
 * Requires valid exam session cookie
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params

    // Get and validate the exam session
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('exam_session')

    if (!sessionCookie?.value) {
      return NextResponse.json(
        { error: 'No exam session found' },
        { status: 401 }
      )
    }

    // Validate the session and get user info (no skriptId = returns full session data)
    const sessionData = await validateExamSession(sessionCookie.value) as ExamSessionData | null

    if (!sessionData) {
      return NextResponse.json(
        { error: 'Invalid or expired exam session' },
        { status: 401 }
      )
    }

    // Note: We allow hand-in from any page in the skript, not just the original pageId
    // This is intentional - multi-page exams should allow hand-in from any page

    // Use the session's original pageId for the submission record
    // This ensures consistency even if hand-in is triggered from a different page in the skript
    const examPageId = sessionData.pageId

    // Optional snapshots: client gathers each on-page code editor's IndexedDB
    // state and posts them alongside the hand-in. Stored as `kind='handin'`
    // checkpoints atomic with the ExamSubmission so the teacher's timeline
    // captures exactly what was handed in.
    let snapshots: HandinSnapshot[] = []
    try {
      const body = await request.json().catch(() => ({}))
      if (Array.isArray(body?.snapshots)) {
        snapshots = body.snapshots.filter((s: unknown): s is HandinSnapshot =>
          !!s && typeof s === 'object' &&
          typeof (s as HandinSnapshot).componentId === 'string' &&
          (s as HandinSnapshot).payload !== undefined
        )
      }
    } catch {
      // Body is optional; ignore parse failures.
    }

    // Atomic: ExamSubmission + checkpoints succeed or fail together. If
    // checkpoint inserts blow up, the submission isn't recorded either, and
    // the student stays on the page to retry. Idempotent on re-submit:
    // returns the existing submission's submittedAt without duplicating.
    const handinResult = await prisma.$transaction(async (tx) => {
      return applyHandinSnapshots(tx, {
        pageId: examPageId,
        studentId: sessionData.userId,
        snapshots,
      })
    })

    if (handinResult.alreadyExisted) {
      return NextResponse.json({
        message: 'Already submitted',
        submittedAt: handinResult.submittedAt,
      })
    }

    // Find the student's class for this exam to emit event
    // The student should be a member of a class that has this page unlocked
    const membership = await prisma.classMembership.findFirst({
      where: {
        studentId: sessionData.userId,
        class: {
          pageUnlocks: {
            some: { pageId: examPageId }
          }
        }
      },
      select: { classId: true }
    })

    if (membership) {
      // Emit SSE event for teacher dashboard real-time updates
      await eventBus.publish(`exam:${examPageId}:${membership.classId}`, {
        type: 'exam-student-status',
        pageId: examPageId,
        classId: membership.classId,
        studentId: sessionData.userId,
        status: 'submitted',
        timestamp: Date.now()
      })
    }

    return NextResponse.json({
      success: true,
      submissionId: handinResult.submissionId,
      submittedAt: handinResult.submittedAt
    })
  } catch (error) {
    console.error('Error recording exam submission:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/exams/[pageId]/hand-in
 * Check if current student has already submitted
 * Requires valid exam session cookie
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params

    // Get and validate the exam session
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('exam_session')

    if (!sessionCookie?.value) {
      return NextResponse.json(
        { error: 'No exam session found' },
        { status: 401 }
      )
    }

    const sessionData = await validateExamSession(sessionCookie.value) as ExamSessionData | null

    if (!sessionData) {
      return NextResponse.json(
        { error: 'Invalid or expired exam session' },
        { status: 401 }
      )
    }

    // Check for existing submission (for the page this session was started from)
    const submission = await prisma.examSubmission.findUnique({
      where: {
        pageId_studentId: {
          pageId: sessionData.pageId, // Use original session's pageId
          studentId: sessionData.userId
        }
      }
    })

    return NextResponse.json({
      hasSubmitted: !!submission,
      submittedAt: submission?.submittedAt || null
    })
  } catch (error) {
    console.error('Error checking submission status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
