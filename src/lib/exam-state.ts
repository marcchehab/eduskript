/**
 * Exam lifecycle state — the single source of truth for exam assignment + timing.
 *
 * An ExamState row's existence == "assigned" (the exam is on that class's radar);
 * its `state` controls entry. No applicable row == hidden.
 *   - class row:   studentId = null  → applies to the whole class
 *   - student row: studentId set     → overrides the class row for that one student
 *
 * Effective state for a student = student override ?? class row ?? hidden.
 * Replaces the old PageUnlock(class) + separate ExamState split. Individual
 * makeups/accommodations are now per-student rows instead of PageUnlock(studentId).
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export type ExamLifecycleState = 'hidden' | 'closed' | 'lobby' | 'open'

export const EXAM_STATES: ExamLifecycleState[] = ['hidden', 'closed', 'lobby', 'open']

// open > lobby > closed > hidden — used to pick the most permissive when a
// student is in several unlocked classes for the same page (so class iteration
// order can't change what they see).
const RANK: Record<ExamLifecycleState, number> = { hidden: 0, closed: 1, lobby: 2, open: 3 }

function normalize(state: string): ExamLifecycleState {
  return (EXAM_STATES as string[]).includes(state) ? (state as ExamLifecycleState) : 'hidden'
}

/**
 * The effective exam state for a single student on a page. Per-student override
 * wins; otherwise the most-open class-level row across their class memberships;
 * otherwise hidden.
 */
export async function resolveExamState(pageId: string, studentId: string): Promise<ExamLifecycleState> {
  // 1) Per-student override (any class) wins outright.
  const studentRow = await prisma.examState.findFirst({
    where: { pageId, studentId },
    select: { state: true },
  })
  if (studentRow) return normalize(studentRow.state)

  // 2) Else the class-level row(s) for the student's class memberships.
  const classRows = await prisma.examState.findMany({
    where: {
      pageId,
      studentId: null,
      class: { memberships: { some: { studentId } } },
    },
    select: { state: true },
  })
  if (classRows.length === 0) return 'hidden'

  return classRows
    .map((r) => normalize(r.state))
    .reduce((best, s) => (RANK[s] > RANK[best] ? s : best), 'hidden' as ExamLifecycleState)
}

/**
 * Class-level `where` for "this class has activity on the page" — an ExamState
 * row (any state, class- or student-level) OR a member who submitted. Use to
 * authorize teacher access to a class's exam data without depending on the exam
 * still being assigned, so grading/scoring/snapshots survive setting it back to
 * hidden. Spread alongside other class filters, e.g.
 * `class: { teacherId, ...examClassActivityWhere(pageId) }`.
 */
export function examClassActivityWhere(pageId: string): Prisma.ClassWhereInput {
  return {
    OR: [
      { examStates: { some: { pageId } } },
      { memberships: { some: { student: { examSubmissions: { some: { pageId } } } } } },
    ],
  }
}
