/**
 * Text-output comparison + partial-credit scoring for free-text quiz questions
 * (predict-the-output exercises). Pure, dependency-free, unit-tested.
 *
 * Used by `quiz.tsx` to auto-check a `type="text"` answer against an expected
 * output: a normalized comparison yields a similarity ratio (0–1) for partial
 * credit and an exact flag for full-correct/gate, plus a line diff for feedback.
 *
 * We implement Levenshtein + an LCS line diff here rather than pulling in `diff`
 * / `fast-levenshtein` — both are only transitive deps with no types, and the
 * algorithms are small and standard.
 */

export interface CompareOptions {
  /** Compare case-insensitively. */
  ignoreCase?: boolean
  /** Collapse internal runs of whitespace to a single space per line. */
  ignoreWhitespace?: boolean
}

/**
 * Normalize output for comparison: unify line endings, strip trailing
 * whitespace per line, and drop leading/trailing blank lines — so a stray
 * trailing newline or platform line ending never costs the student credit.
 * Internal blank lines are preserved (they're meaningful in output).
 */
export function normalizeOutput(text: string | null | undefined, opts: CompareOptions = {}): string {
  let lines = (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      let l = line.replace(/[ \t]+$/, '') // trailing whitespace
      if (opts.ignoreWhitespace) l = l.replace(/[ \t]+/g, ' ').trim()
      return l
    })

  // Drop leading/trailing blank lines.
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()

  let result = lines.join('\n')
  if (opts.ignoreCase) result = result.toLowerCase()
  return result
}

/** Levenshtein edit distance between two strings (space-optimized, O(n·m) time, O(min) space). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  // Keep the shorter string as the inner (column) dimension to minimize memory.
  if (a.length > b.length) [a, b] = [b, a]

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i)
  const curr = new Array<number>(a.length + 1)
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost)
    }
    for (let i = 0; i <= a.length; i++) prev[i] = curr[i]
  }
  return prev[a.length]
}

/** Similarity ratio in [0, 1]: 1 = identical, 0 = completely different. */
export function similarityRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1 // both empty → identical
  return 1 - levenshtein(a, b) / max
}

export type DiffRow =
  | { type: 'equal'; value: string }
  | { type: 'expected'; value: string } // present in expected, missing from the student's answer
  | { type: 'student'; value: string } // present in the student's answer, not in expected

/**
 * Line-level diff (LCS) between expected and student output, for feedback.
 * `expected` rows are what was wanted but missing; `student` rows are extra/
 * wrong lines the student wrote. Handles inserted/deleted lines (a missing
 * early line doesn't mark everything after it wrong).
 */
export function diffLines(expected: string, student: string): DiffRow[] {
  const e = expected === '' ? [] : expected.split('\n')
  const s = student === '' ? [] : student.split('\n')
  // LCS length table.
  const lcs: number[][] = Array.from({ length: e.length + 1 }, () =>
    new Array<number>(s.length + 1).fill(0),
  )
  for (let i = e.length - 1; i >= 0; i--) {
    for (let j = s.length - 1; j >= 0; j--) {
      lcs[i][j] = e[i] === s[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < e.length && j < s.length) {
    if (e[i] === s[j]) {
      rows.push({ type: 'equal', value: e[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: 'expected', value: e[i] })
      i++
    } else {
      rows.push({ type: 'student', value: s[j] })
      j++
    }
  }
  while (i < e.length) rows.push({ type: 'expected', value: e[i++] })
  while (j < s.length) rows.push({ type: 'student', value: s[j++] })
  return rows
}

export interface CompareResult {
  /** Similarity ratio in [0, 1] over the normalized strings. */
  ratio: number
  /** True when the normalized strings are identical (full credit / gate). */
  exact: boolean
  /** Normalized forms (handy for tests + rendering). */
  normalizedExpected: string
  normalizedStudent: string
  /** Line diff for feedback rendering. */
  diff: DiffRow[]
}

/** Compare a student's typed output against the expected output. */
export function compareOutput(
  student: string | null | undefined,
  expected: string | null | undefined,
  opts: CompareOptions = {},
): CompareResult {
  const ne = normalizeOutput(expected, opts)
  const ns = normalizeOutput(student, opts)
  return {
    ratio: similarityRatio(ns, ne),
    exact: ns === ne,
    normalizedExpected: ne,
    normalizedStudent: ns,
    diff: diffLines(ne, ns),
  }
}

/**
 * Partial-credit score: a fraction `ratio` of `points`, rounded to 0.1 points
 * (e.g. ratio 0.93 × 2 pts → 1.9). Clamps ratio to [0, 1].
 */
export function scoreFromRatio(ratio: number, points: number): number {
  const r = Math.min(1, Math.max(0, ratio))
  return Math.round(r * points * 10) / 10
}
