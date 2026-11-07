/**
 * Exam archive: self-contained copies of students' exams (ExamRecord, see
 * prisma/schema.prisma), kept RETENTION_YEARS after the return (or after
 * archiving, when never returned), then deleted by the daily cron
 * (src/app/api/cron/route.ts → purgeExpiredExamRecords).
 *
 * Written by:
 * - the return route (src/app/api/exams/[pageId]/grading/return/route.ts),
 *   with the frozen score snapshot of that return;
 * - archiving a class (PATCH /api/classes/[id] { archived: true }), for every
 *   submitted exam of its members on the teacher's managed sites.
 * One record per (page, student, site); later writes overwrite it, so the
 * record holds the latest return.
 *
 * The payload copies the page markdown, the scores, the answers and the exam
 * log, so the record survives deleting the page, class or accounts. Not
 * copied: earlier code checkpoints, files uploaded in answers, ungraded
 * components (only those in the scores are kept).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildReviewScores, type ReviewScores } from '@/lib/scoring/review-payload'
import { getCurrentReturn } from '@/lib/scoring/return-state'
import { getManagedSiteIds } from '@/lib/site-access'
import { readComponentSubmissions } from '@/lib/scoring/submissions'
import { getExamVersionContent } from '@/lib/scoring/exam-version'
import type { GradableComponent } from '@/lib/scoring/components'

export const RETENTION_YEARS = 5

export interface ExamRecordPayload {
  version: 1
  pageTitle: string
  /** Page markdown of the version the student handed in (exam-version.ts),
   *  else of the live page at archive time. */
  content: string
  /** That version's number; null = live page at archive time. */
  pageVersion: number | null
  scores: ReviewScores
  /**
   * Per componentId: `text` = the submitted answer as text (readComponentSubmissions:
   * hand-in code for python, else the live answer; quiz choices as option
   * indices), `raw` = the stored quiz UserData (null for python / no answer).
   */
  answers: Record<string, { text: string; raw: unknown }>
  log: { event: string; occurredAt: string; score: number | null; createdBy: string | null }[]
}

export function retainUntil(from: Date): Date {
  const d = new Date(from)
  d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS)
  return d
}

interface RecordInput {
  teacherId: string
  pageId: string
  studentId: string
  siteId: string
  /** Class to file the record under; null keeps the record's current one. */
  classId: string | null
  /** Frozen scores (a return's snapshot); omitted = current scores. */
  scores?: ReviewScores
  /** When it was returned; omitted = from the exam log. */
  returnedAt?: Date | null
}

/**
 * Create or overwrite the record of one exam. Resolves false when the page or
 * the student no longer exists (nothing left to copy). O(components) rows read.
 */
export async function writeExamRecord(input: RecordInput): Promise<boolean> {
  const { teacherId, pageId, studentId, siteId } = input
  const [page, student, submission, cls] = await Promise.all([
    prisma.page.findUnique({ where: { id: pageId }, select: { title: true, content: true } }),
    prisma.user.findUnique({ where: { id: studentId }, select: { name: true, studentPseudonym: true, email: true } }),
    prisma.examSubmission.findUnique({
      where: { pageId_studentId_siteId: { pageId, studentId, siteId } },
      select: { submittedAt: true, pageVersion: true },
    }),
    input.classId
      ? prisma.class.findUnique({ where: { id: input.classId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ])
  if (!page || !student) return false
  const handedIn = await getExamVersionContent(pageId, submission?.pageVersion)

  let returnedAt = input.returnedAt
  let scores = input.scores
  if (returnedAt === undefined || !scores) {
    const ret = await getCurrentReturn(pageId, studentId, siteId)
    if (returnedAt === undefined) returnedAt = ret?.returned ? ret.at : null
    scores ??= ret?.returned && ret.snapshot ? ret.snapshot : await buildReviewScores(pageId, studentId, siteId)
  }

  const componentIds = scores.components.map((c) => c.componentId)
  const sites = new Map([[studentId, siteId]])
  const [texts, answerRows, log, membership] = await Promise.all([
    // O(components) queries, one per component.
    Promise.all(scores.components.map(async (c) => {
      const component = { componentId: c.componentId, kind: c.kind } as GradableComponent
      const sub = await readComponentSubmissions(pageId, component, [studentId], sites)
      return [c.componentId, sub.get(studentId)?.text ?? ''] as const
    })),
    componentIds.length
      ? prisma.userData.findMany({
          where: { userId: studentId, siteId, itemId: pageId, adapter: { in: componentIds }, targetType: null },
          select: { adapter: true, data: true },
        })
      : Promise.resolve([]),
    prisma.examAuditLog.findMany({
      where: { pageId, studentId, siteId },
      orderBy: { occurredAt: 'asc' },
      select: { event: true, occurredAt: true, score: true, createdBy: true },
    }),
    cls
      ? prisma.classMembership.findUnique({
          where: { classId_studentId: { classId: cls.id, studentId } },
          select: { identityConsent: true },
        })
      : Promise.resolve(null),
  ])
  const raw = new Map(answerRows.map((r) => [r.adapter, r.data]))
  const answers: ExamRecordPayload['answers'] = {}
  for (const [id, text] of texts) answers[id] = { text, raw: raw.get(id) ?? null }

  const payload: ExamRecordPayload = {
    version: 1,
    pageTitle: page.title,
    content: handedIn?.content ?? page.content,
    pageVersion: handedIn?.version ?? null,
    scores,
    answers,
    log: log.map((l) => ({ event: l.event, occurredAt: l.occurredAt.toISOString(), score: l.score, createdBy: l.createdBy })),
  }
  const data = {
    teacherId,
    pageTitle: page.title,
    studentName: student.name,
    studentPseudonym: student.studentPseudonym,
    // The email only with the student's consent to show it to this class's teacher.
    ...(cls ? { classId: cls.id, className: cls.name, studentEmail: membership?.identityConsent ? student.email : null } : {}),
    submittedAt: submission?.submittedAt ?? null,
    returnedAt,
    score: scores.totalEarned,
    maxScore: scores.totalMax,
    grade: scores.grade,
    payload: payload as unknown as Prisma.InputJsonValue,
    retainUntil: retainUntil(returnedAt ?? new Date()),
  }
  await prisma.examRecord.upsert({
    where: { pageId_studentId_siteId: { pageId, studentId, siteId } },
    create: { pageId, studentId, siteId, ...data },
    update: data,
  })
  return true
}

/**
 * The teacher's class to file a student's exam under: one with this exam
 * assigned (class-level ExamState), else any of the teacher's classes the
 * student is in. Archived classes count too. null = none.
 */
export async function findExamClass(teacherId: string, pageId: string, studentId: string): Promise<string | null> {
  const classes = await prisma.class.findMany({
    where: { teacherId, isImplicit: false, memberships: { some: { studentId } } },
    select: { id: true, examStates: { where: { pageId, studentId: null }, select: { id: true }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  })
  return (classes.find((c) => c.examStates.length > 0) ?? classes[0])?.id ?? null
}

/**
 * Copy every submitted exam of the class's members on the teacher's managed
 * sites into ExamRecord. A record is filed under this class when the exam was
 * assigned to it, or when it has no class yet; one already filed under
 * another class (a student in two classes) stays there. Sequential:
 * O(submissions) writes, each O(components). Returns the number written.
 */
export async function archiveClassExams(classId: string, teacherId: string): Promise<number> {
  const [members, siteIds, assigned] = await Promise.all([
    prisma.classMembership.findMany({ where: { classId }, select: { studentId: true } }),
    getManagedSiteIds(teacherId),
    prisma.examState.findMany({ where: { classId, studentId: null }, select: { pageId: true } }),
  ])
  if (members.length === 0 || siteIds.length === 0) return 0
  const assignedPages = new Set(assigned.map((a) => a.pageId))

  const submissions = await prisma.examSubmission.findMany({
    where: { studentId: { in: members.map((m) => m.studentId) }, siteId: { in: siteIds } },
    select: { pageId: true, studentId: true, siteId: true },
  })
  if (submissions.length === 0) return 0
  const existing = await prisma.examRecord.findMany({
    where: { OR: submissions.map((s) => ({ pageId: s.pageId, studentId: s.studentId, siteId: s.siteId })) },
    select: { pageId: true, studentId: true, siteId: true, classId: true },
  })
  const classOf = new Map(existing.map((r) => [`${r.pageId}:${r.studentId}:${r.siteId}`, r.classId]))

  let written = 0
  for (const s of submissions) {
    const current = classOf.get(`${s.pageId}:${s.studentId}:${s.siteId}`)
    const fileHere = assignedPages.has(s.pageId) || !current || current === classId
    if (await writeExamRecord({ teacherId, ...s, classId: fileHere ? classId : null })) written++
  }
  return written
}

/** Delete records past their retention date (daily cron). Returns the count. */
export async function purgeExpiredExamRecords(now = new Date()): Promise<number> {
  const { count } = await prisma.examRecord.deleteMany({ where: { retainUntil: { lt: now } } })
  return count
}
