/**
 * Matching questions (`<question type="match">`, "Zuordnen"): pure helpers
 * shared by the quiz widget (components/markdown/quiz.tsx), the server-side
 * page parser (lib/scoring/components.ts), answer rendering for teachers
 * (lib/scoring/submissions.ts, survey export) and the survey-responses route.
 *
 * Authoring:
 *
 *   <question id="z" type="match" points="6">
 *   Prompt …
 *   <answer match="Parabel 1">$f(x)=x^2-1$</answer>      ← row
 *   <answer match="Parabel 4"></answer>                   ← distractor target only
 *   </question>
 *
 * - Every `<answer>` with a `match` attribute AND non-empty content is a row.
 *   Rows are indexed densely (0..N-1) in authored order, counting rows only —
 *   distractor-only answers and answers without `match` do not shift the index.
 *   Like choice indices, reordering rows after students answered reassigns
 *   stored answers to other rows.
 * - The targets offered in every row's dropdown are all distinct `match` values
 *   of the question (rows + distractors), trimmed, in natural sort order
 *   ("Parabel 2" < "Parabel 10"), so the order never reveals the key.
 * - Stored answer: `QuizData.matchAnswer = { "<row index>": "<target>" }`.
 * - Score: points × (correct rows / rows), rounded to 0.1 like the other
 *   auto-checks (scoreFromRatio).
 */

/** Stored answer: row index (as string) → chosen target. */
export type MatchAnswer = Record<string, string>

export interface MatchRow {
  /** Correct target for this row (trimmed `match` value). */
  match: string
}

/** Natural, case-insensitive order: "Parabel 2" < "Parabel 10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** Distinct, trimmed, non-empty targets in natural sort order. O(n log n). */
export function matchTargets(matches: Array<string | undefined | null>): string[] {
  const set = new Set<string>()
  for (const m of matches) {
    const t = (m ?? '').trim()
    if (t) set.add(t)
  }
  return [...set].sort(naturalCompare)
}

export interface MatchResult {
  correct: number
  total: number
  /** correct / total; 0 when there are no rows. */
  ratio: number
  /** Per row: true/false, or null when the row was left blank. */
  rows: Array<boolean | null>
}

/** Compare a stored answer with the per-row key (key[i] = correct target of row i). */
export function matchResult(answer: MatchAnswer | null | undefined, key: string[]): MatchResult {
  const rows = key.map((target, i) => {
    const picked = answer?.[String(i)]
    if (picked == null || picked === '') return null
    return picked.trim() === target.trim()
  })
  const correct = rows.filter((r) => r === true).length
  const total = key.length
  return { correct, total, ratio: total > 0 ? correct / total : 0, rows }
}

/** Number of rows the student answered (non-empty choice). */
export function answeredRowCount(answer: MatchAnswer | null | undefined): number {
  if (!answer) return 0
  return Object.values(answer).filter((v) => typeof v === 'string' && v !== '').length
}

const MAX_ROWS = 200
const MAX_TARGET_LENGTH = 500

/**
 * Validate an untrusted answer (survey POST): an object of non-negative integer
 * keys → strings. Drops invalid entries; null when the shape is wrong.
 */
export function sanitizeMatchAnswer(value: unknown): MatchAnswer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: MatchAnswer = {}
  let n = 0
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{1,4}$/.test(k)) continue
    if (typeof v !== 'string' || v.length > MAX_TARGET_LENGTH) continue
    if (++n > MAX_ROWS) break
    out[String(Number(k))] = v
  }
  return out
}

/**
 * One-line text rendering of an answer for teachers / LLMs / CSV:
 * "1: label → Target; 2: … → (blank)". Labels are optional (row numbers only
 * when absent). Rows are listed in index order.
 */
export function formatMatchAnswer(answer: MatchAnswer | null | undefined, rowLabels?: string[]): string {
  if (!answer) return ''
  const indices = new Set<number>(Object.keys(answer).map(Number).filter(Number.isInteger))
  rowLabels?.forEach((_, i) => indices.add(i))
  return [...indices]
    .sort((a, b) => a - b)
    .map((i) => {
      const label = rowLabels?.[i]
      const target = answer[String(i)] || '(blank)'
      return `${i + 1}${label ? `: ${label}` : ''} → ${target}`
    })
    .join('; ')
}

// --- Server-side markdown parsing -------------------------------------------

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return m ? (m[1] ?? m[2]) : undefined
}

export interface ParsedMatchQuestion {
  /** Rows in order: raw markdown label (trimmed) + correct target. */
  rows: Array<{ label: string; match: string }>
  /** All distinct targets in natural order (rows + distractors). */
  targets: string[]
}

/**
 * Parse the rows/targets of a match question from its raw markdown body (the
 * text between `<question …>` and `</question>`). Regex-based: assumes
 * `<answer>` tags are not nested and contain no literal `</answer>`. Labels
 * stay raw markdown (math as `$…$`), which is what text-only consumers want.
 */
export function parseMatchQuestionMarkdown(body: string): ParsedMatchQuestion {
  const rows: Array<{ label: string; match: string }> = []
  const all: string[] = []
  const re = /<answer\b([^>]*?)(?:\/>|>([\s\S]*?)<\/answer>)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const match = attr(m[1], 'match')?.trim()
    if (!match) continue
    all.push(match)
    const label = (m[2] ?? '').trim()
    if (label) rows.push({ label, match })
  }
  return { rows, targets: matchTargets(all) }
}
