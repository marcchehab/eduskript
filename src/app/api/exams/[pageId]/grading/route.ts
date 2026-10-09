/**
 * Batched grading data for one exam page + class. One round-trip for the
 * grading table: the question list (componentIds + max + label), the grade
 * config, and per-student totals/grade/status. Site scoping: the caller must
 * MANAGE a site holding the exam (personal owner / org owner+admin); the table
 * aggregates all of the caller's managed sites (src/lib/scoring/site-scope.ts).
 *
 * GET /api/exams/[pageId]/grading?classId=xxx
 * GET /api/exams/[pageId]/grading?classesOnly=1 — just the class picker list.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeExamGrades } from '@/lib/scoring/aggregate'
import { getExamClassesForTeacher, getExamUrl } from '@/lib/scoring/auth'
import { getExamScope, getGradingStudentIds, isExamContentAuthor, resolveStudentSites } from '@/lib/scoring/site-scope'
import { getCurrentReturnsForPage } from '@/lib/scoring/return-state'

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
    const searchParams = new URL(request.url).searchParams
    const classId = searchParams.get('classId')
    const classesOnly = searchParams.get('classesOnly') !== null
    if (!classId && !classesOnly) {
      return NextResponse.json({ error: 'classId query parameter is required' }, { status: 400 })
    }

    // Site scoping: the viewer's MANAGED sites that relate to this exam
    // (src/lib/scoring/site-scope.ts). Authorship grants nothing; no admin bypass.
    const scope = await getExamScope(session.user.id, pageId)
    if (!scope) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }
    const page = scope.page

    // Every class this teacher owns with the exam unlocked OR holding a submitted
    // answer on one of the scope sites — the picker options. Org owners/admins
    // usually have none; 'all' still lists their sites' submissions.
    const allClasses = await getExamClassesForTeacher(pageId, session.user.id, scope.siteIds)

    // Picker-only mode: skip the per-student grade computation below.
    if (classesOnly) {
      return NextResponse.json({ classes: allClasses })
    }
    if (!classId) {
      return NextResponse.json({ error: 'classId query parameter is required' }, { status: 400 })
    }

    // Students: a specific class's members (must be the teacher's), or for
    // 'all' every related class member PLUS every student who submitted on a
    // managed site — all managed sites together (one view).
    const studentIdList = await getGradingStudentIds(scope, session.user.id, pageId, classId)
    if (!studentIdList) {
      return NextResponse.json({ error: 'Not the teacher of this class' }, { status: 403 })
    }
    const targetClassIds = classId === 'all' ? allClasses.map((c) => c.id) : [classId]

    const [memberships, users] = await Promise.all([
      prisma.classMembership.findMany({
        where: { classId: { in: targetClassIds }, studentId: { in: studentIdList } },
        select: {
          classId: true,
          studentId: true,
          identityConsent: true,
          class: { select: { name: true } },
        },
      }),
      prisma.user.findMany({
        where: { id: { in: studentIdList } },
        select: { id: true, name: true, email: true, studentPseudonym: true },
      }),
    ])
    // A student could be in more than one target class; show them once.
    const membershipByStudent = new Map<string, (typeof memberships)[number]>()
    for (const m of memberships) if (!membershipByStudent.has(m.studentId)) membershipByStudent.set(m.studentId, m)
    const userById = new Map(users.map((u) => [u.id, u]))
    const studentIds = studentIdList.filter((id) => userById.has(id))
    const studentSites = await resolveStudentSites(pageId, studentIds, scope.siteIds)

    // Return status comes from the exam log (single source of truth), not a flag.
    const [grading, submissions, returns] = await Promise.all([
      computeExamGrades(pageId, studentIds, studentSites),
      prisma.examSubmission.findMany({
        where: { pageId, studentId: { in: studentIds }, siteId: { in: scope.siteIds } },
        select: { studentId: true, siteId: true, submittedAt: true, source: true },
      }),
      getCurrentReturnsForPage(pageId, studentSites),
    ])
    const subByStudent = new Map(
      submissions.filter((s) => studentSites.get(s.studentId) === s.siteId).map((s) => [s.studentId, s]),
    )

    const students = studentIds.map((studentId) => {
      const m = membershipByStudent.get(studentId)
      const u = userById.get(studentId)!
      const g = grading.byStudent.get(studentId)!
      const sub = subByStudent.get(studentId)
      const ret = returns.get(studentId)
      const status: 'not_started' | 'submitted' | 'returned' = ret?.returned
        ? 'returned'
        : sub
          ? 'submitted'
          : 'not_started'
      return {
        studentId,
        // Site of the attempt shown in this row — pass it to per-student calls.
        siteId: studentSites.get(studentId) ?? null,
        name: u.name,
        // Real email only after the student consented to reveal identity (a
        // class consent flag; non-class org respondents never reveal it).
        email: m?.identityConsent ? u.email : null,
        pseudonym: u.studentPseudonym,
        className: m?.class?.name ?? null,
        status,
        source: sub?.source ?? null,
        submittedAt: sub?.submittedAt ?? null,
        returnedAt: ret?.returned ? ret.at : null,
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
      // In-exam link for the viewer's first scope site (personal site → /exam).
      examUrl: await getExamUrl(pageId, scope.siteIds[0]),
      siteIds: scope.siteIds,
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
      // Grade key / rubric are exam content: only authors may change them
      // (rule 1). Graders on placing sites read them.
      canEditContent: await isExamContentAuthor(session.user.id, pageId),
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
