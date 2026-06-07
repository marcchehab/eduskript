/**
 * Exam Students Status API Route
 *
 * GET: For teachers to see student status:
 * - Students currently taking the exam (active sessions)
 * - Students who have submitted (handed in)
 * - Students who haven't started (class members without sessions)
 *
 * POST: Reopen exam for a specific student
 * - Deletes their submission record
 * - Allows them to re-enter the exam
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { applyHandinSnapshots } from '@/lib/exam-recovery'

interface StudentStatus {
  id: string
  name: string | null
  email: string | null
  studentPseudonym: string | null
  status: 'not_started' | 'taking' | 'submitted'
  source?: string
  startedAt?: Date
  submittedAt?: Date
  /** Throwaway emergency-laptop account → enables the "Transfer answers" action. */
  isTemporary?: boolean
}

/**
 * GET /api/exams/[pageId]/students?classId=xxx
 * Get status of all students in a class for this exam
 * Only accessible by page authors who are also the class teacher
 */
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

    if (!classId) {
      return NextResponse.json(
        { error: 'classId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify user is a page author
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        authors: {
          some: { userId: session.user.id }
        }
      },
      select: {
        id: true,
        skriptId: true
      }
    })

    if (!page) {
      return NextResponse.json(
        { error: 'Page not found or access denied' },
        { status: 404 }
      )
    }

    // Verify user is the teacher of this class
    const classRecord = await prisma.class.findFirst({
      where: {
        id: classId,
        teacherId: session.user.id
      }
    })

    if (!classRecord) {
      return NextResponse.json(
        { error: 'Class not found or you are not the teacher' },
        { status: 403 }
      )
    }

    // Get all students in the class
    const classMemberships = await prisma.classMembership.findMany({
      where: { classId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            studentPseudonym: true,
            isTemporary: true
          }
        }
      }
    })

    const studentIds = classMemberships.map(m => m.studentId)

    // Get active exam sessions for these students on this skript
    const activeSessions = await prisma.examSession.findMany({
      where: {
        userId: { in: studentIds },
        skriptId: page.skriptId,
        expiresAt: { gt: new Date() }
      },
      select: {
        userId: true,
        createdAt: true
      }
    })

    const sessionByUserId = new Map(
      activeSessions.map(s => [s.userId, s])
    )

    // Get submissions for these students on this page
    const submissions = await prisma.examSubmission.findMany({
      where: {
        pageId,
        studentId: { in: studentIds }
      },
      select: {
        studentId: true,
        submittedAt: true,
        source: true
      }
    })

    const submissionByUserId = new Map(
      submissions.map(s => [s.studentId, s])
    )

    // Build status list
    const students: StudentStatus[] = classMemberships.map(m => {
      const submission = submissionByUserId.get(m.studentId)
      const activeSession = sessionByUserId.get(m.studentId)

      let status: 'not_started' | 'taking' | 'submitted'
      if (submission) {
        status = 'submitted'
      } else if (activeSession) {
        status = 'taking'
      } else {
        status = 'not_started'
      }

      return {
        id: m.student.id,
        name: m.student.name,
        email: m.student.email,
        studentPseudonym: m.student.studentPseudonym,
        isTemporary: m.student.isTemporary,
        status,
        source: submission?.source,
        startedAt: activeSession?.createdAt,
        submittedAt: submission?.submittedAt
      }
    })

    // Sort: taking first, then submitted, then not started
    const statusOrder = { taking: 0, submitted: 1, not_started: 2 }
    students.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

    // Count summary
    const counts = {
      total: students.length,
      notStarted: students.filter(s => s.status === 'not_started').length,
      taking: students.filter(s => s.status === 'taking').length,
      submitted: students.filter(s => s.status === 'submitted').length
    }

    return NextResponse.json({
      students,
      counts
    })
  } catch (error) {
    console.error('Error fetching exam students:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/exams/[pageId]/students
 * Reopen exam for a specific student (delete their submission)
 * Body: { studentId: string, classId: string, action: 'reopen' }
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
    const { studentId, classId, action } = body

    if (!studentId || !classId || (action !== 'reopen' && action !== 'force-submit')) {
      return NextResponse.json(
        { error: 'studentId, classId, and action ("reopen" | "force-submit") are required' },
        { status: 400 }
      )
    }

    // Verify user is a page author
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        authors: {
          some: { userId: session.user.id }
        }
      },
      select: {
        id: true,
        skriptId: true
      }
    })

    if (!page) {
      return NextResponse.json(
        { error: 'Page not found or access denied' },
        { status: 404 }
      )
    }

    // Verify user is the teacher of this class
    const classRecord = await prisma.class.findFirst({
      where: {
        id: classId,
        teacherId: session.user.id
      }
    })

    if (!classRecord) {
      return NextResponse.json(
        { error: 'Class not found or you are not the teacher' },
        { status: 403 }
      )
    }

    // Verify the student is in this class
    const membership = await prisma.classMembership.findFirst({
      where: {
        classId,
        studentId
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'Student not found in this class' },
        { status: 404 }
      )
    }

    // Force-submit: end the exam ON BEHALF of a student who never handed in (e.g.
    // their machine crashed). Creates the ExamSubmission so the student appears in
    // grading; their answers are whatever was autosaved to UserData (grading reads
    // live UserData when there's no hand-in snapshot). Idempotent.
    if (action === 'force-submit') {
      const result = await prisma.$transaction((tx) =>
        applyHandinSnapshots(tx, { pageId, studentId, snapshots: [], label: 'ended by teacher', source: 'teacher' }),
      )
      // applyHandinSnapshots only sets source on CREATE; ensure an already-existing
      // submission (e.g. a re-run, or one created before this field) is tagged too.
      if (result.alreadyExisted) {
        await prisma.examSubmission.update({
          where: { pageId_studentId: { pageId, studentId } },
          data: { source: 'teacher' },
        })
      }
      await eventBus.publish(`exam:${pageId}:${classId}`, {
        type: 'exam-student-status',
        pageId,
        classId,
        studentId,
        status: 'submitted',
        timestamp: Date.now(),
      })
      return NextResponse.json({
        success: true,
        message: result.alreadyExisted ? 'Already submitted' : 'Exam ended for student',
        submittedAt: result.submittedAt,
      })
    }

    // Delete the submission to allow re-entry
    await prisma.examSubmission.deleteMany({
      where: {
        pageId,
        studentId
      }
    })

    // Also delete any expired sessions so they can start fresh
    // (Keep active sessions so they don't lose in-progress work)
    await prisma.examSession.deleteMany({
      where: {
        userId: studentId,
        skriptId: page.skriptId,
        expiresAt: { lt: new Date() }
      }
    })

    // Append-only audit log: the roster pairs this "reopened" event with
    // the previous "submitted" to draw the attempt boundary, and with the
    // next "started" to begin the new attempt's duration.
    await prisma.examAuditLog.create({
      data: { pageId, studentId, event: 'reopened' }
    })

    // Notify the student via SSE so their page can refresh
    await eventBus.publish(`user:${studentId}`, {
      type: 'exam-reopened',
      pageId,
      timestamp: Date.now()
    })

    return NextResponse.json({
      success: true,
      message: 'Exam reopened for student'
    })
  } catch (error) {
    console.error('Error reopening exam for student:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
