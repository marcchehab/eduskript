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

export function normalize(state: string): ExamLifecycleState {
  return (EXAM_STATES as string[]).includes(state) ? (state as ExamLifecycleState) : 'hidden'
}

export interface ExamStateResolution {
  state: ExamLifecycleState
  /**
   * The class whose row produced `state` — i.e. the `exam:<pageId>:<classId>`
   * SSE channel that carries changes to it (see the exam waiting room). Null
   * when the state is 'hidden' (no row at all).
   */
  classId: string | null
  /**
   * True when a per-student override produced `state`. The waiting room needs
   * this to ignore class-level events, which don't apply to an overridden
   * student (acting on them would bounce the student between views).
   */
  isStudentOverride: boolean
}

/**
 * The effective exam state for a single student on a page, plus which row it
 * came from. Per-student override wins; otherwise the most-open class-level row
 * across their class memberships; otherwise hidden.
 *
 * Limitation: for a student in several classes with rows on the same page, only
 * the winning class's id is returned, so a live update on one of the *other*
 * classes' rows isn't streamed. The waiting room's poll + manual refresh cover
 * that case.
 */
export async function resolveExamStateDetail(
  pageId: string,
  studentId: string,
): Promise<ExamStateResolution> {
  // 1) Per-student override (any class) wins outright.
  const studentRow = await prisma.examState.findFirst({
    where: { pageId, studentId },
    select: { state: true, classId: true },
  })
  if (studentRow) {
    return { state: normalize(studentRow.state), classId: studentRow.classId, isStudentOverride: true }
  }

  // 2) Else the class-level row(s) for the student's class memberships.
  const classRows = await prisma.examState.findMany({
    where: {
      pageId,
      studentId: null,
      class: { memberships: { some: { studentId } } },
    },
    select: { state: true, classId: true },
  })
  if (classRows.length === 0) return { state: 'hidden', classId: null, isStudentOverride: false }

  const best = classRows.reduce((a, b) =>
    RANK[normalize(b.state)] > RANK[normalize(a.state)] ? b : a,
  )
  return { state: normalize(best.state), classId: best.classId, isStudentOverride: false }
}

/** State only — see resolveExamStateDetail. */
export async function resolveExamState(pageId: string, studentId: string): Promise<ExamLifecycleState> {
  return (await resolveExamStateDetail(pageId, studentId)).state
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
