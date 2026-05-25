/**
 * Swiss 1–6 grade formula. Pure functions — imported by the server (return
 * route, batched grading API) AND the client grading table (live recompute as
 * the teacher edits the key). No DB, no React.
 *
 * Two formulas, teacher-selectable:
 * - "twoSegment" (default): two straight lines so the pass grade lands exactly
 *   at the teacher's pass percentage. 1 → passGrade over [0, passPercent], then
 *   passGrade → topGrade over [passPercent, 100]. Lets a teacher put 4.0 at 55%
 *   or 60% independently of the max.
 * - "linear": a single line, grade = bottom + (top−bottom)·(points/max). With
 *   the 1–6 / pass-60 defaults this puts 4.0 at exactly 60%; passPercent is
 *   ignored.
 *
 * Related: [[output-comparison]] (scoreFromRatio — per-question partial credit).
 */

export type GradeFormula = 'linear' | 'twoSegment'

export interface GradeConfigParams {
  formula: GradeFormula
  /** Where the pass grade lands, 0–100. Used by twoSegment only. */
  passPercent: number
  /** The pass grade (Swiss convention: 4.0). twoSegment only. */
  passGrade: number
  topGrade: number
  bottomGrade: number
  /** Round the final grade to this step, e.g. 0.1, 0.25, 0.5. */
  roundingStep: number
}

export const DEFAULT_GRADE_CONFIG: GradeConfigParams = {
  formula: 'twoSegment',
  passPercent: 60,
  passGrade: 4,
  topGrade: 6,
  bottomGrade: 1,
  roundingStep: 0.1,
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Round to the nearest multiple of `step` (e.g. 0.1 → 4.27→4.3, 0.5 → 4.27→4.5). */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return value
  // Scale to integers to avoid float drift (e.g. 0.1 * 43 !== 4.3 exactly).
  return Math.round(value / step) * step
}

/**
 * Grade for a percentage [0, 100], unrounded math then rounded to step and
 * clamped to [bottomGrade, topGrade]. Degenerate configs (passPercent 0 or 100)
 * fall back gracefully to the linear segment.
 */
export function gradeFromPercent(pct: number, cfg: GradeConfigParams): number {
  const p = clamp(pct, 0, 100)
  const { formula, passPercent, passGrade, topGrade, bottomGrade, roundingStep } = cfg

  let raw: number
  if (formula === 'twoSegment' && passPercent > 0 && passPercent < 100) {
    raw =
      p <= passPercent
        ? bottomGrade + (passGrade - bottomGrade) * (p / passPercent)
        : passGrade + (topGrade - passGrade) * ((p - passPercent) / (100 - passPercent))
  } else {
    // linear (or twoSegment with a degenerate passPercent)
    raw = bottomGrade + (topGrade - bottomGrade) * (p / 100)
  }

  return clamp(roundToStep(raw, roundingStep), bottomGrade, topGrade)
}

/** Convenience: grade from earned/max points. max ≤ 0 → bottomGrade. */
export function gradeFromPoints(earned: number, max: number, cfg: GradeConfigParams): number {
  if (!(max > 0)) return cfg.bottomGrade
  return gradeFromPercent((earned / max) * 100, cfg)
}
