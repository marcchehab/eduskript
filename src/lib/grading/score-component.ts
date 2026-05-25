/**
 * Per-component scoring: turn one gradable component's stored answer (a QuizData
 * or PythonCheckData payload from UserData) plus its declared max and any
 * teacher override into `{earned, max}`. Pure — no DB.
 *
 * Auto scores:
 * - text quiz   → QuizData.textScore   (partial credit, scoreFromRatio)
 * - choice quiz → QuizData.choiceScore (max on exact match, else 0)
 * - python      → `checkRun.earned` — the AUTHORITATIVE result of re-running the
 *   student's submitted code on the teacher's device (ExamCheckRun). The client's
 *   PythonCheckData.earnedPoints is NOT trusted for grading (tamper-able, and
 *   absent in real exams where Check is hidden). null checkRun = not yet run → 0.
 * number/range/sql have no auto score — gradable only via a teacher override.
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
  /** Latest UserData payload for this component (null = unanswered). Quiz only. */
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

/** Auto-earned points, or null if nothing to score. */
function autoEarnedPoints(input: ComponentScoreInput): number | null {
  const { kind, questionType, payload, checkRun } = input
  if (kind === 'python') {
    // Authoritative re-run only — never the client's PythonCheckData.
    return checkRun ? checkRun.earned : null
  }
  if (!payload) return null
  if (questionType === 'text') {
    return typeof payload.textScore === 'number' ? payload.textScore : null
  }
  if (questionType === 'single' || questionType === 'multiple') {
    return typeof payload.choiceScore === 'number' ? payload.choiceScore : null
  }
  // number / range / unknown: no auto score
  return null
}

/** Best-effort max when the markdown didn't declare one (python: the re-run's max). */
function payloadMax(input: ComponentScoreInput): number | null {
  if (input.kind === 'python' && input.checkRun) return input.checkRun.max
  return null
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
