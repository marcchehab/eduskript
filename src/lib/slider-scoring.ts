/**
 * Auto-check for slider questions (`type="number"` and `type="range"`).
 *
 * Mirrors the free-text auto-check in output-comparison.ts: an answer produces a
 * ratio in [0, 1], the ratio buys partial credit via `scoreFromRatio`, and the
 * author can hang graded feedback off it. Nothing here knows about React.
 */

/** Default falloff window as a fraction of the slider's own span. */
const DEFAULT_WINDOW_FRACTION = 0.25

export interface NumberCheck {
  expected: number
  /** Distance that still counts as fully correct. */
  tolerance: number
  /** Distance beyond the tolerance at which the ratio reaches 0. */
  window: number
}

/**
 * `expected="-1..1"` → an interval, `expected="-1"` → a single value.
 * Accepts `..`, `…` and a comma so authors don't have to remember one spelling.
 */
export function parseExpectedRange(value: string): { min: number; max: number } | null {
  const parts = value.split(/\.\.|…|,/).map((p) => p.trim()).filter(Boolean)
  if (parts.length !== 2) return null
  const min = Number(parts[0])
  const max = Number(parts[1])
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return min <= max ? { min, max } : { min: max, max: min }
}

export function parseExpectedNumber(value: string): number | null {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

/** Falloff window when the author didn't set one: a quarter of the slider span. */
export function defaultWindow(minValue: number, maxValue: number): number {
  return Math.abs(maxValue - minValue) * DEFAULT_WINDOW_FRACTION
}

/**
 * Number slider: 1 inside the tolerance, then linear down to 0 across `window`.
 * A zero-width window degenerates to right/wrong, which is what an author who
 * writes `window="0"` is asking for.
 */
export function numberRatio(answer: number, check: NumberCheck): number {
  const distance = Math.abs(answer - check.expected)
  if (distance <= check.tolerance) return 1
  if (check.window <= 0) return 0
  const overshoot = distance - check.tolerance
  return Math.max(0, 1 - overshoot / check.window)
}

/**
 * Range slider: overlap of the two intervals divided by their union (Jaccard).
 * Guessing too wide costs the same as guessing too narrow, which is the point —
 * "somewhere between -3 and 3" should not score well for a narrow target.
 *
 * Two degenerate (zero-width) intervals compare by distance instead, so a
 * student who dragged both handles onto the same value still gets a sane score.
 */
export function rangeRatio(
  answer: { min: number; max: number },
  expected: { min: number; max: number }
): number {
  const overlap = Math.max(0, Math.min(answer.max, expected.max) - Math.max(answer.min, expected.min))
  const union = Math.max(answer.max, expected.max) - Math.min(answer.min, expected.min)
  if (union <= 0) return answer.min === expected.min ? 1 : 0
  return overlap / union
}
