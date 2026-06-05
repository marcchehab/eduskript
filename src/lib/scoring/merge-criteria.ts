/**
 * Per-criterion score merge for the unified rubric-based scoring panel.
 *
 * A teacher's manual override is stored sparsely on the override ComponentScore
 * row (`meta.criteria` = only the criteria they edited). The EFFECTIVE per-
 * criterion value is the teacher's override if present, else the AI's value:
 *   points  : override.points  ?? ai.points  ?? 0
 *   comment : override.comment ?? ai.comment
 * The component total is the sum of effective points over the rubric's criteria.
 *
 * This total is materialised into override.earned at write time (here + the AI
 * re-score path), so the priority resolver ([[score-component]]) is unchanged —
 * override (priority 100) still wins wholesale with the correct merged total.
 * Related: [[aggregate]].
 */

export interface OverrideCriterion {
  id: string
  /** Present only when the teacher overrode this criterion's points. */
  points?: number
  /** Present only when the teacher overrode this criterion's comment. */
  comment?: string
}

export interface AiCriterion {
  id: string
  points: number
  comment?: string
}

/**
 * Effective component total = Σ over the rubric's criteria of
 * (override.points ?? ai.points ?? 0). Returns null when NO source has any
 * points at all (e.g. a comment-only override with no AI score) — i.e. nothing
 * is actually scored, so the override row carries only feedback/comments.
 *
 * `rubricIds` is the authoritative criterion set; if empty (no rubric) the union
 * of scored ids is used so a pure-manual or AI-only score still totals correctly.
 */
export function mergedCriterionTotal(
  rubricIds: string[],
  aiCriteria: AiCriterion[],
  overrideCriteria: OverrideCriterion[],
): number | null {
  const ai = new Map(aiCriteria.map((c) => [c.id, Number(c.points) || 0]))
  const ov = new Map(
    overrideCriteria.filter((c) => typeof c.points === 'number').map((c) => [c.id, c.points as number]),
  )
  if (ai.size === 0 && ov.size === 0) return null
  const ids = rubricIds.length ? rubricIds : [...new Set([...ai.keys(), ...ov.keys()])]
  let sum = 0
  for (const id of ids) sum += ov.get(id) ?? ai.get(id) ?? 0
  return Math.round(sum * 10) / 10
}
