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
 *
 * Site scoping: every event carries the site the attempt belongs to
 * (ExamAuditLog.siteId); return state is per (page, student, site).
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

/** Per-page status for the student's own list, plus the headline numbers read
 *  from the frozen snapshot (null when not returned, or for legacy returns
 *  stored without a snapshot — caller recomputes). */
export interface StudentReturnStatus extends ReturnStatus {
  grade: number | null
  totalEarned: number | null
  totalMax: number | null
}

interface LatestRow {
  page_id?: string
  site_id?: string
  student_id?: string
  event: string
  score: number | null
  occurred_at: Date
  created_by: string | null
}

/** Full current-return state (incl. frozen snapshot) for ONE student. null = the
 *  student has no return-relevant event yet (never returned). */
export async function getCurrentReturn(pageId: string, studentId: string, siteId: string): Promise<CurrentReturn | null> {
  const row = await prisma.examAuditLog.findFirst({
    where: { pageId, studentId, siteId, event: { in: RETURN_EVENTS } },
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
export async function isStudentReturned(pageId: string, studentId: string, siteId: string): Promise<boolean> {
  const row = await prisma.examAuditLog.findFirst({
    where: { pageId, studentId, siteId, event: { in: RETURN_EVENTS } },
    orderBy: { occurredAt: 'desc' },
    select: { event: true },
  })
  return isReturnedFromLatest(row?.event)
}

/** Current-return status per student for ONE page (no snapshot). Powers the
 *  teacher grading table. `studentSites` maps each student to the site whose
 *  log counts (src/lib/scoring/site-scope.ts). */
export async function getCurrentReturnsForPage(
  pageId: string,
  studentSites: Map<string, string>,
): Promise<Map<string, ReturnStatus>> {
  if (studentSites.size === 0) return new Map()
  const studentIds = [...studentSites.keys()]
  const siteIds = [...new Set(studentSites.values())]
  const rows = await prisma.$queryRaw<LatestRow[]>(Prisma.sql`
    SELECT DISTINCT ON (student_id, site_id) student_id, site_id, event, score, occurred_at, created_by
    FROM exam_audit_logs
    WHERE page_id = ${pageId}
      AND event IN ('return', 'take_back', 'reopened')
      AND student_id IN (${Prisma.join(studentIds)})
      AND site_id IN (${Prisma.join(siteIds)})
    ORDER BY student_id, site_id, occurred_at DESC
  `)
  const map = new Map<string, ReturnStatus>()
  for (const r of rows) {
    if (studentSites.get(r.student_id!) !== r.site_id) continue
    map.set(r.student_id!, { returned: isReturnedFromLatest(r.event), score: r.score, at: r.occurred_at, by: r.created_by })
  }
  return map
}

/** Map key for getCurrentReturnsForStudent: one entry per (page, site). */
export function pageSiteKey(pageId: string, siteId: string): string {
  return `${pageId}\u0000${siteId}`
}

/** Current-return status per (page, site) for ONE student — keyed by
 *  pageSiteKey(). Powers the student "My Exams" list. Doesn't fetch the whole
 *  snapshot — only grade/totalEarned/totalMax are extracted from it in SQL
 *  (JSONB ->>). */
export async function getCurrentReturnsForStudent(studentId: string): Promise<Map<string, StudentReturnStatus>> {
  const rows = await prisma.$queryRaw<
    (LatestRow & { grade: number | null; total_earned: number | null; total_max: number | null })[]
  >(Prisma.sql`
    SELECT DISTINCT ON (page_id, site_id) page_id, site_id, event, score, occurred_at, created_by,
      (payload->>'grade')::float8 AS grade,
      (payload->>'totalEarned')::float8 AS total_earned,
      (payload->>'totalMax')::float8 AS total_max
    FROM exam_audit_logs
    WHERE student_id = ${studentId}
      AND event IN ('return', 'take_back', 'reopened')
    ORDER BY page_id, site_id, occurred_at DESC
  `)
  const map = new Map<string, StudentReturnStatus>()
  for (const r of rows) {
    const returned = isReturnedFromLatest(r.event)
    map.set(pageSiteKey(r.page_id!, r.site_id ?? ''), {
      returned,
      score: r.score,
      at: r.occurred_at,
      by: r.created_by,
      grade: returned ? r.grade : null,
      totalEarned: returned ? r.total_earned : null,
      totalMax: returned ? r.total_max : null,
    })
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
