/**
 * Return state — derived SOLELY from the exam event log (ExamAuditLog). There is
 * NO denormalized `returnedAt` flag on ExamSubmission; this module is the single
 * source of truth, so return state can never drift out of sync with the log.
 *
 * A student is "currently returned" iff their LATEST event in
 * {return, take_back, reopened} is a `return`. So a take-back un-returns, and a
 * reopen (which appends `reopened`) also naturally un-returns. Every `return`
 * event keeps its own frozen snapshot in `payload`; re-returning appends a new
 * event, so the original return is preserved forever.
 *
 * All reads are indexed (DISTINCT ON / LIMIT 1 on (page_id, student_id,
 * occurred_at)); callers are low-QPS (teacher loads a grading table, a student
 * opens their result). The per-page/per-student batch helpers deliberately DON'T
 * fetch `payload` (the ~100KB snapshot) — only getCurrentReturn() does, for the
 * single-student review/grade paths that actually render it. Related: [[review-payload]].
 */
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ReviewScores } from './review-payload'

/** Events that change return state, newest-wins. Lifecycle pings (started/
 *  submitted) don't affect it; `reopened` resets it to not-returned. */
export const RETURN_EVENTS = ['return', 'take_back', 'reopened']

/** Currently returned iff the latest return-relevant event is a `return`
 *  (`take_back` and `reopened` both un-return). Pure; the caller supplies the
 *  newest event's name (null = no return-relevant event yet). */
export function isReturnedFromLatest(latestEvent: string | null | undefined): boolean {
  return latestEvent === 'return'
}

/** Lightweight current-return status (no snapshot). */
export interface ReturnStatus {
  returned: boolean
  /** Aggregate points frozen at the last `return` (null on take_back/reopened). */
  score: number | null
  /** When the latest return-relevant event occurred. */
  at: Date
  /** Teacher who returned/took back (null for `reopened` / legacy). */
  by: string | null
}
export interface CurrentReturn extends ReturnStatus {
  /** Frozen review payload from the last `return` (null when not currently returned). */
  snapshot: ReviewScores | null
}

interface LatestRow {
  page_id?: string
  student_id?: string
  event: string
  score: number | null
  occurred_at: Date
  created_by: string | null
}

/** Full current-return state (incl. frozen snapshot) for ONE student. null = the
 *  student has no return-relevant event yet (never returned). */
export async function getCurrentReturn(pageId: string, studentId: string): Promise<CurrentReturn | null> {
  const row = await prisma.examAuditLog.findFirst({
    where: { pageId, studentId, event: { in: RETURN_EVENTS } },
    orderBy: { occurredAt: 'desc' },
    select: { event: true, payload: true, score: true, occurredAt: true, createdBy: true },
  })
  if (!row) return null
  const returned = isReturnedFromLatest(row.event)
  return {
    returned,
    snapshot: returned ? (row.payload as unknown as ReviewScores) : null,
    score: row.score,
    at: row.occurredAt,
    by: row.createdBy,
  }
}

/** Is THIS student currently returned? (Cheap — selects only the latest event.) */
export async function isStudentReturned(pageId: string, studentId: string): Promise<boolean> {
  const row = await prisma.examAuditLog.findFirst({
    where: { pageId, studentId, event: { in: RETURN_EVENTS } },
    orderBy: { occurredAt: 'desc' },
    select: { event: true },
  })
  return isReturnedFromLatest(row?.event)
}

/** Current-return status per student for ONE page (no snapshot). Powers the
 *  teacher grading table. Pass studentIds to scope; omit for all students. */
export async function getCurrentReturnsForPage(
  pageId: string,
  studentIds?: string[],
): Promise<Map<string, ReturnStatus>> {
  if (studentIds && studentIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<LatestRow[]>(Prisma.sql`
    SELECT DISTINCT ON (student_id) student_id, event, score, occurred_at, created_by
    FROM exam_audit_logs
    WHERE page_id = ${pageId}
      AND event IN ('return', 'take_back', 'reopened')
      ${studentIds ? Prisma.sql`AND student_id IN (${Prisma.join(studentIds)})` : Prisma.empty}
    ORDER BY student_id, occurred_at DESC
  `)
  const map = new Map<string, ReturnStatus>()
  for (const r of rows) {
    map.set(r.student_id!, { returned: isReturnedFromLatest(r.event), score: r.score, at: r.occurred_at, by: r.created_by })
  }
  return map
}

/** Current-return status per page for ONE student (no snapshot). Powers the
 *  student "My Exams" list. */
export async function getCurrentReturnsForStudent(studentId: string): Promise<Map<string, ReturnStatus>> {
  const rows = await prisma.$queryRaw<LatestRow[]>(Prisma.sql`
    SELECT DISTINCT ON (page_id) page_id, event, score, occurred_at, created_by
    FROM exam_audit_logs
    WHERE student_id = ${studentId}
      AND event IN ('return', 'take_back', 'reopened')
    ORDER BY page_id, occurred_at DESC
  `)
  const map = new Map<string, ReturnStatus>()
  for (const r of rows) {
    map.set(r.page_id!, { returned: isReturnedFromLatest(r.event), score: r.score, at: r.occurred_at, by: r.created_by })
  }
  return map
}

/** Does ANY student on this page currently have a returned exam? Exam-level lock
 *  for AI rubric generation. */
export async function examHasReturnedStudent(pageId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ ok: number }[]>(Prisma.sql`
    SELECT 1 AS ok FROM (
      SELECT DISTINCT ON (student_id) event
      FROM exam_audit_logs
      WHERE page_id = ${pageId} AND event IN ('return', 'take_back', 'reopened')
      ORDER BY student_id, occurred_at DESC
    ) t WHERE event = 'return' LIMIT 1
  `)
  return rows.length > 0
}

/** Uniform 409 for a blocked score/rubric edit on a returned exam. The client
 *  keys off `code` to show a "take it back first" hint. */
export function returnedLockResponse(scope: 'student' | 'exam') {
  return NextResponse.json(
    {
      error:
        scope === 'student'
          ? 'This exam has been returned to the student. Take it back before changing scores.'
          : 'This exam has returned students. Take them back before changing the rubric.',
      code: 'EXAM_RETURNED_LOCKED',
    },
    { status: 409 },
  )
}
