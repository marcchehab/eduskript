/**
 * Return scored exams to students. Writes the aggregate score + scoredBy/At +
 * returnedAt on each ExamSubmission and notifies the student via SSE so their
 * My Exams view updates. Teacher-only.
 *
 * POST /api/exams/[pageId]/grading/return
 * body: { studentId }              → return one student
 *       { all: true, classId }     → return every submitted student in the class
 *
 * Only students who have actually submitted are returned (no submission row =
 * skipped). Idempotent: re-returning just refreshes the score + timestamp.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { computeExamGrades } from '@/lib/scoring/aggregate'
import { getAuthoredExamPage, isClassTeacher, isTeacherOfStudentForPage } from '@/lib/scoring/auth'

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
    if (!(await getAuthoredExamPage(session.user.id, pageId))) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))

    // Resolve the target student set.
    let studentIds: string[]
    if (body.all === true) {
      const classId = body.classId as string | undefined
      let classIds: string[]
      if (classId && classId !== 'all') {
        if (!(await isClassTeacher(session.user.id, classId))) {
          return NextResponse.json({ error: 'Not the teacher of this class' }, { status: 403 })
        }
        classIds = [classId]
      } else {
        // Every class this teacher owns that has the exam unlocked.
        const unlocks = await prisma.pageUnlock.findMany({
          where: { pageId, classId: { not: null }, class: { teacherId: session.user.id } },
          select: { classId: true },
        })
        classIds = [...new Set(unlocks.map((u) => u.classId!).filter(Boolean))]
      }
      const members = await prisma.classMembership.findMany({
        where: { classId: { in: classIds } },
        select: { studentId: true },
      })
      studentIds = [...new Set(members.map((m) => m.studentId))]
    } else {
      const studentId = body.studentId as string | undefined
      if (!studentId) {
        return NextResponse.json({ error: 'studentId or all+classId is required' }, { status: 400 })
      }
      if (!(await isTeacherOfStudentForPage(session.user.id, studentId, pageId))) {
        return NextResponse.json({ error: 'Not the teacher of this student' }, { status: 403 })
      }
      studentIds = [studentId]
    }

    // Only students with a submission can be returned.
    const submissions = await prisma.examSubmission.findMany({
      where: { pageId, studentId: { in: studentIds } },
      select: { studentId: true },
    })
    const submittedIds = submissions.map((s) => s.studentId)
    if (submittedIds.length === 0) {
      return NextResponse.json({ returned: 0, students: [] })
    }

    const grading = await computeExamGrades(pageId, submittedIds)
    const now = new Date()

    await prisma.$transaction(
      submittedIds.map((studentId) =>
        prisma.examSubmission.update({
          where: { pageId_studentId: { pageId, studentId } },
          data: {
            score: grading.byStudent.get(studentId)?.totalEarned ?? 0,
            scoredBy: session.user.id,
            scoredAt: now,
            returnedAt: now,
          },
        }),
      ),
    )

    // Notify each student (fire-and-forget on the user channel).
    await Promise.all(
      submittedIds.map((studentId) =>
        eventBus.publish(`user:${studentId}`, {
          type: 'exam-returned',
          pageId,
          studentId,
          timestamp: now.getTime(),
        }),
      ),
    )

    return NextResponse.json({ returned: submittedIds.length, students: submittedIds })
  } catch (error) {
    console.error('[grading/return] POST failed:', error)
    return NextResponse.json({ error: 'Failed to return exams' }, { status: 500 })
  }
}
