/**
 * Deterministic regex check for a rubric criterion. A "check" criterion is scored
 * by running this against the student's submission — full points on match, 0 else
 * — instead of asking the LLM (see [[scoring]] / RUBRIC_SYSTEM). Used for
 * syntax/presence criteria the model judges unreliably in a multi-criterion call.
 *
 * Safety: the pattern comes from the AI or the teacher (not the student), and the
 * input is small student code, so ReDoS risk is low — but we still cap the pattern
 * and input length and reject `g` (stateful test()), and treat any compile/run
 * error as "no match" with a flag. This is NOT a hard ReDoS sandbox (JS has no sync
 * regex timeout); the caps make catastrophic backtracking impractical here.
 */

const MAX_PATTERN = 1_000
const MAX_INPUT = 20_000

export interface CheckResult {
  matched: boolean
  /** Set when the pattern was missing/invalid/too long — caller should treat the
   *  criterion as unscored-by-check (fall back to 0 / surface to the teacher). */
  error?: string
}

/** Keep only safe flags; drop `g`/`y` (stateful with .test()). Default multiline. */
export function sanitizeFlags(flags?: string): string {
  const kept = (flags ?? '').split('').filter((c) => 'imsu'.includes(c))
  const set = [...new Set(kept)].join('')
  return set || 'm'
}

// An inline regex embedded in a criterion description: "... (using Regex: /pat/flags)".
// This is the single source of truth — a criterion with one is scored deterministically
// by that regex; without one, the AI judges it. The teacher edits the regex by editing
// the description text. `[^/]` with `\\.`-escape allows slashes inside the pattern.
const INLINE_RE = /\(\s*(?:using\s+)?regex:\s*\/((?:\\.|[^/])+)\/([a-z]*)\s*\)/i

/** The human-readable description with the "(using Regex: …)" annotation removed. */
export function stripInlineRegex(description: string): string {
  if (typeof description !== 'string') return description
  return description.replace(INLINE_RE, '').replace(/\s{2,}/g, ' ').trim()
}

/** Extract the inline regex from a description, or null if absent/invalid. */
export function extractCriterionRegex(description: string): { pattern: string; flags?: string } | null {
  const m = typeof description === 'string' ? description.match(INLINE_RE) : null
  if (!m) return null
  try {
    new RegExp(m[1], sanitizeFlags(m[2] || undefined))
  } catch {
    return null
  }
  return { pattern: m[1], ...(m[2] ? { flags: m[2] } : {}) }
}

export function runCriterionCheck(pattern: string, flags: string | undefined, submission: string): CheckResult {
  if (typeof pattern !== 'string' || pattern.length === 0) return { matched: false, error: 'no pattern' }
  if (pattern.length > MAX_PATTERN) return { matched: false, error: 'pattern too long' }
  let re: RegExp
  try {
    re = new RegExp(pattern, sanitizeFlags(flags))
  } catch {
    return { matched: false, error: 'invalid regex' }
  }
  const text = submission.length > MAX_INPUT ? submission.slice(0, MAX_INPUT) : submission
  try {
    return { matched: re.test(text) }
  } catch {
    return { matched: false, error: 'regex execution failed' }
  }
}
