/**
 * Per-component scoring: resolve the effective points for one gradable component
 * from its list of score sources (ComponentScore rows). Pure — no DB.
 *
 * Each source is one verdict: check (asserts re-run on the teacher's device),
 * ai (rubric applied by an LLM), override (teacher's manual points), or a future
 * source. The effective points are the highest-`priority` source with a non-null
 * `earned`; feedback is resolved independently, also by highest priority. Ties
 * (equal priority) break to the most recently updated row.
 *
 * This generalizes the former `override ?? checkRun` rule to N sources. The
 * client's stored scores (QuizData.textScore/choiceScore, PythonCheckData.
 * earnedPoints) are never read here — they are live-preview only and the student
 * device is never the scorer; the trusted values live in ComponentScore rows.
 *
 * `score`/`scoring` = points (Punkte); the 1-6 grade is computed only by the
 * grade key. Related: [[grade-formula]], [[aggregate]].
 */

export type GradableKind = 'quiz' | 'python'

/** Seeded priority per source. Higher wins. Stored per ComponentScore row so a
 *  future source can slot anywhere and a teacher action can re-rank without a
 *  migration; this map is the default used when writing a fresh row. */
export const SCORE_PRIORITY: Record<string, number> = {
  check: 10,
  ai: 20,
  override: 100,
}

/** One scoring verdict from one source (a ComponentScore row, or a test stub). */
export interface ScoreSource {
  source: string
  priority: number
  /** Points; null = the row carries only feedback. */
  earned: number | null
  max?: number | null
  feedback?: string | null
  /** Tiebreak for equal priority (most recent wins). */
  updatedAt?: Date | number | null
}

export interface ComponentScoreInput {
  /** Max points declared in the page markdown (authoritative when present). */
  declaredMax?: number | null
  /** All score sources for this component+student. */
  sources: ScoreSource[]
}

export interface ComponentScore {
  earned: number
  max: number
  /** A source produced gradable points. */
  answered: boolean
  /** Effective points came from a manual teacher override. */
  overridden: boolean
  /** Which source won the points (null = nothing scored yet). */
  effectiveSource: string | null
  /** The check-source points (the "auto" score), for an "auto: 1.5" display. */
  autoEarned: number
  /** The ai-source points, if an AI score exists (for an "AI: 1.5" display). */
  aiEarned: number | null
  /** Effective per-question feedback (highest-priority source with a note). */
  feedback: string | null
}

function ts(v: Date | number | null | undefined): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : v.getTime()
}

/** Highest priority first; equal priority → most recently updated first. */
function byPriority(a: ScoreSource, b: ScoreSource): number {
  return b.priority - a.priority || ts(b.updatedAt) - ts(a.updatedAt)
}

export function scoreComponent(input: ComponentScoreInput): ComponentScore {
  const sources = input.sources ?? []

  const pointRows = sources.filter((s) => s.earned != null).sort(byPriority)
  const effective = pointRows[0] ?? null

  const feedbackRows = sources
    .filter((s) => s.feedback != null && s.feedback !== '')
    .sort(byPriority)
  const feedback = feedbackRows[0]?.feedback ?? null

  // Max: a teacher override's explicit max wins (it can re-weight a question for
  // one student) → the declared markdown max (the question's authoritative max) →
  // any source's reported max (e.g. the check/ai max) → 1. A check/ai max never
  // supersedes the declared max.
  const overrideMax = sources.find((s) => s.source === 'override')?.max ?? null
  const fallbackMax = sources.filter((s) => s.max != null).sort(byPriority)[0]?.max ?? null
  const max = overrideMax ?? input.declaredMax ?? fallbackMax ?? 1

  const autoEarned = sources.find((s) => s.source === 'check')?.earned ?? 0
  const aiEarned = sources.find((s) => s.source === 'ai')?.earned ?? null

  return {
    earned: effective?.earned ?? 0,
    max,
    answered: effective != null,
    overridden: effective?.source === 'override',
    effectiveSource: effective?.source ?? null,
    autoEarned,
    aiEarned,
    feedback,
  }
}
