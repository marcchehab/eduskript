/**
 * Per-component scoring: turn one gradable component's stored answer (a QuizData
 * or PythonCheckData payload from UserData) plus its declared max and any
 * teacher override into `{earned, max}`. Pure — no DB.
 *
 * Auto scores — all AUTHORITATIVE values come from `checkRun` (ExamCheckRun),
 * the result computed on the TEACHER's device during grading. The client's
 * stored scores (QuizData.textScore/choiceScore, PythonCheckData.earnedPoints)
 * are live-preview only and NOT trusted here (tamper-able; and the student's
 * device is never the grader). null checkRun = not yet graded → 0.
 * - text quiz          → `checkRun.earned` (teacher re-ran the similarity check)
 * - single/multiple    → `checkRun.earned` (teacher re-derived choice correctness)
 * - python             → `checkRun.earned` (teacher re-ran the asserts)
 * number/range/sql and free-text without an answer key have no auto score —
 * gradable only via a teacher override.
 *
 * A teacher override (ExamQuestionGrade) always WINS for earned (and for max,
 * if it set one).
 *
 * Related: [[grade-formula]], [[output-comparison]].
 */

import type { QuizData, PythonCheckData } from '@/lib/userdata/types'

export type GradableKind = 'quiz' | 'python'

export interface ComponentScoreInput {
  kind: GradableKind
  /** Quiz subtype: 'single' | 'multiple' | 'text' | 'number' | 'range'. */
  questionType?: string
  /** Max points declared in the page markdown (authoritative when present). */
  declaredMax?: number | null
  /** Latest UserData payload for this component. No longer read for scoring
   *  (authoritative scores come from `checkRun`); retained for callers/tests. */
  payload?: Partial<QuizData & PythonCheckData> | null
  /** Authoritative re-run result for python components (null = not run). */
  checkRun?: { earned: number; max: number } | null
  /** Teacher override, if any. */
  override?: { awardedPoints: number; maxPoints?: number | null } | null
}

export interface ComponentScore {
  earned: number
  max: number
  /** The student produced a gradable answer (or there's an override). */
  answered: boolean
  /** A teacher override is in effect. */
  overridden: boolean
  /** Auto score before any override (for showing "auto: 1.5" next to an edit). */
  autoEarned: number
}

/** Auto-earned points, or null if nothing to score (not yet graded). */
function autoEarnedPoints(input: ComponentScoreInput): number | null {
  const { kind, questionType, checkRun } = input
  // python + auto-gradable quiz (text/single/multiple) all read the
  // teacher-device re-run. Never the client's stored scores.
  if (kind === 'python') return checkRun ? checkRun.earned : null
  if (questionType === 'text' || questionType === 'single' || questionType === 'multiple') {
    return checkRun ? checkRun.earned : null
  }
  // number / range / unknown: no auto score
  return null
}

/** Best-effort max when the markdown didn't declare one (the re-run's max). */
function payloadMax(input: ComponentScoreInput): number | null {
  return input.checkRun ? input.checkRun.max : null
}

export function scoreComponent(input: ComponentScoreInput): ComponentScore {
  const auto = autoEarnedPoints(input)
  // Resolve max: override max → declared (markdown) → payload-derived → 1.
  const max =
    input.override?.maxPoints ??
    input.declaredMax ??
    payloadMax(input) ??
    1

  if (input.override) {
    return {
      earned: input.override.awardedPoints,
      max,
      answered: true,
      overridden: true,
      autoEarned: auto ?? 0,
    }
  }

  return {
    earned: auto ?? 0,
    max,
    answered: auto !== null,
    overridden: false,
    autoEarned: auto ?? 0,
  }
}
