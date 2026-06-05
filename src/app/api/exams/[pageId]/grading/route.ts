/**
 * Batched grading data for one exam page + class. One round-trip for the
 * grading table: the question list (componentIds + max + label), the grade
 * config, and per-student totals/grade/status. Teacher-only (page author +
 * class teacher).
 *
 * GET /api/exams/[pageId]/grading?classId=xxx
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeExamGrades } from '@/lib/scoring/aggregate'
import { getAuthoredExamPage, getExamUrl, isClassTeacher } from '@/lib/scoring/auth'

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
    const classId = new URL(request.url).searchParams.get('classId')
    if (!classId) {
      return NextResponse.json({ error: 'classId query parameter is required' }, { status: 400 })
    }

    const page = await getAuthoredExamPage(session.user.id, pageId)
    if (!page) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    // Every class this teacher owns that has the exam unlocked — the picker
    // options, and the target set when classId === 'all'. The same exam is
    // often given to several classes under one grade key (per-page config).
    const unlocks = await prisma.pageUnlock.findMany({
      where: { pageId, classId: { not: null }, class: { teacherId: session.user.id } },
      select: { class: { select: { id: true, name: true } } },
    })
    const allClasses = [...new Map(unlocks.flatMap((u) => (u.class ? [[u.class.id, u.class]] : [])) as [string, { id: string; name: string }][]).values()]

    // Resolve target classes: a specific one (must be the teacher's) or all.
    let targetClassIds: string[]
    if (classId === 'all') {
      targetClassIds = allClasses.map((c) => c.id)
    } else {
      if (!(await isClassTeacher(session.user.id, classId))) {
        return NextResponse.json({ error: 'Not the teacher of this class' }, { status: 403 })
      }
      targetClassIds = [classId]
    }

    const memberships = await prisma.classMembership.findMany({
      where: { classId: { in: targetClassIds } },
      select: {
        classId: true,
        studentId: true,
        identityConsent: true,
        class: { select: { name: true } },
        student: { select: { id: true, name: true, email: true, studentPseudonym: true } },
      },
    })
    // A student could be in more than one target class; show them once.
    const seenStudents = new Set<string>()
    const uniqueMemberships = memberships.filter((m) => {
      if (seenStudents.has(m.studentId)) return false
      seenStudents.add(m.studentId)
      return true
    })
    const studentIds = uniqueMemberships.map((m) => m.studentId)

    const [grading, submissions] = await Promise.all([
      computeExamGrades(pageId, studentIds),
      prisma.examSubmission.findMany({
        where: { pageId, studentId: { in: studentIds } },
        select: { studentId: true, submittedAt: true, returnedAt: true, score: true },
      }),
    ])
    const subByStudent = new Map(submissions.map((s) => [s.studentId, s]))

    const students = uniqueMemberships.map((m) => {
      const g = grading.byStudent.get(m.studentId)!
      const sub = subByStudent.get(m.studentId)
      const status: 'not_started' | 'submitted' | 'returned' = sub?.returnedAt
        ? 'returned'
        : sub
          ? 'submitted'
          : 'not_started'
      return {
        studentId: m.studentId,
        name: m.student.name,
        // Real email only after the student consented to reveal identity.
        email: m.identityConsent ? m.student.email : null,
        pseudonym: m.student.studentPseudonym,
        className: m.class?.name ?? null,
        status,
        submittedAt: sub?.submittedAt ?? null,
        returnedAt: sub?.returnedAt ?? null,
        totalEarned: g.totalEarned,
        totalMax: g.totalMax,
        grade: g.grade,
        components: g.components.map((c) => ({
          componentId: c.componentId,
          earned: c.earned,
          max: c.max,
          answered: c.answered,
          overridden: c.overridden,
          autoEarned: c.autoEarned,
        })),
      }
    })

    return NextResponse.json({
      pageTitle: page.title,
      examUrl: await getExamUrl(pageId),
      classes: allClasses,
      selectedClassId: classId,
      config: {
        formula: grading.params.formula,
        passPercent: grading.params.passPercent,
        passGrade: grading.params.passGrade,
        topGrade: grading.params.topGrade,
        bottomGrade: grading.params.bottomGrade,
        roundingStep: grading.params.roundingStep,
        maxPoints: grading.maxPointsOverride,
      },
      autoMaxPoints: grading.autoMaxPoints,
      questions: grading.components.map((c) => ({
        componentId: c.componentId,
        kind: c.kind,
        questionType: c.questionType ?? null,
        label: c.label ?? null,
        maxPoints: c.maxPoints ?? null,
      })),
      students,
    })
  } catch (error) {
    console.error('[grading] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load grading data' }, { status: 500 })
  }
}
