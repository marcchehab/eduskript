/**
 * Teacher-only content in page markdown, and stripping it for everyone else.
 *
 * - `<solution teacher>…</solution>`: a solution box only page authors see.
 * - `<blank answer="$q_1$" />`: the answer of a fill-in line, shown to authors
 *   in pen colour (and in the print view's teacher copy).
 *
 * Public pages are ISR-rendered once for all viewers, so the shared render
 * can't know who is looking. Instead every public render gets the markdown
 * from `stripTeacherContent`: teacher solution bodies become blank lines (and
 * their attributes, title included, are dropped) and `answer="…"` becomes
 * `data-teacher-slot="n"`. The content is gone from the
 * HTML, the RSC payload and the raw `content` props (AnnotationWrapper,
 * PrintEditSource). Authors fetch the originals from
 * /api/pages/[id]/teacher-content (permission-checked) and render them in
 * place by slot number (components/markdown/teacher-content.tsx).
 *
 * Line count is preserved (bodies → newlines, attribute edits stay on their
 * line), so data-source-line attributes and the print view's line-based
 * edits (/api/pages/[id]/replace with `line`) keep matching the DB content.
 * A print edit touching a stripped line is rejected (409), not merged.
 *
 * Skipped: fenced code blocks and inline code spans on a single line (syntax
 * examples). Limitations: a `<solution>` nested inside a teacher solution
 * ends it at the first `</solution>`; an unclosed teacher solution runs to
 * the end of the page (like linkedSolutions in ai/feedback-context.ts).
 * O(n) in the content length.
 */

import { fencedRanges } from '@/lib/markdown-fences'

// Attribute run inside a tag, quotes respected (same as markdown-compiler.ts TAG_ATTRS).
const TAG_ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`
const SOLUTION_OPEN_RE = new RegExp(`<solution(?![\\w-])(${TAG_ATTRS})>`, 'gi')
const SOLUTION_CLOSE_RE = /<\/solution\s*>/gi
const BLANK_RE = new RegExp(`<blank(?![\\w-])(${TAG_ATTRS})>`, 'gi')
const ATTR_RE = /([^\s=/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>/]+))?/g
const INLINE_CODE_RE = /(`+)(?:(?!\1)[^\n])*?\1/g

export const TEACHER_SLOT_ATTR = 'data-teacher-slot'

interface Attr { name: string; value: string | null; start: number; end: number }

function parseAttrs(attrs: string): Attr[] {
  const out: Attr[] = []
  for (const m of attrs.matchAll(ATTR_RE)) {
    const raw = m[2]
    const value = raw == null ? null : /^["']/.test(raw) ? raw.slice(1, -1) : raw
    out.push({ name: m[1].toLowerCase(), value, start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** `teacher` present and not `teacher="false"`. */
export function isTeacherSolutionAttrs(attrs: string): boolean {
  const a = parseAttrs(attrs).find((x) => x.name === 'teacher')
  return !!a && a.value?.toLowerCase() !== 'false'
}

function excludedRanges(content: string): Array<[number, number]> {
  const ranges = fencedRanges(content)
  for (const m of content.matchAll(INLINE_CODE_RE)) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

export interface TeacherSolution { title: string | null; markdown: string }

export interface StrippedContent {
  /** The markdown without teacher content (same line count). */
  content: string
  /** Each `<solution teacher>` by slot: its title attribute and inner markdown. */
  solutions: TeacherSolution[]
  /** Markdown of each `<blank answer>`, by slot. */
  answers: string[]
}

/**
 * Removes teacher solutions and blank answers. With `slots: false` no
 * `data-teacher-slot` placeholders are added (text for an AI prompt).
 */
export function stripTeacherContent(content: string, { slots = true }: { slots?: boolean } = {}): StrippedContent {
  const solutions: TeacherSolution[] = []
  const answers: string[] = []
  // Fast path: most pages have neither.
  if (!/<solution\b|<blank\b/i.test(content)) return { content, solutions, answers }

  const excluded = excludedRanges(content)
  const isExcluded = (i: number) => excluded.some(([s, e]) => i >= s && i < e)
  const edits: Array<{ start: number; end: number; text: string }> = []

  for (const open of content.matchAll(SOLUTION_OPEN_RE)) {
    const start = open.index
    if (isExcluded(start) || edits.some((e) => start >= e.start && start < e.end)) continue
    const attrs = open[1]
    // Self-closing, not a teacher solution, or already stripped (idempotent).
    if (/\/\s*$/.test(attrs) || !isTeacherSolutionAttrs(attrs) || parseAttrs(attrs).some((a) => a.name === TEACHER_SLOT_ATTR)) continue
    const bodyStart = start + open[0].length
    SOLUTION_CLOSE_RE.lastIndex = bodyStart
    let close: RegExpExecArray | null
    while ((close = SOLUTION_CLOSE_RE.exec(content)) && isExcluded(close.index)) { /* closing tag in code: keep looking */ }
    const bodyEnd = close ? close.index : content.length
    const slot = solutions.length
    const title = parseAttrs(attrs).find((a) => a.name === 'title')?.value ?? null
    solutions.push({ title, markdown: content.slice(bodyStart, bodyEnd) })
    // Only `teacher` and the slot stay: a title can give the answer away too.
    // Newlines inside the attributes stay, so the line count does not change.
    const lost = attrs.replace(/[^\n]/g, '')
    const tag = slots ? `<solution teacher ${TEACHER_SLOT_ATTR}="${slot}"${lost}>` : `<solution teacher${lost}>`
    const newlines = content.slice(bodyStart, bodyEnd).replace(/[^\n]/g, '')
    edits.push({ start, end: bodyEnd, text: tag + newlines })
  }

  for (const m of content.matchAll(BLANK_RE)) {
    const start = m.index
    if (isExcluded(start) || edits.some((e) => start >= e.start && start < e.end)) continue
    const attrs = m[1]
    const answer = parseAttrs(attrs).find((a) => a.name === 'answer')
    if (!answer) continue
    const slot = answers.length
    answers.push(answer.value ?? '')
    // Newlines inside the value stay, so the line count does not change.
    const lost = attrs.slice(answer.start, answer.end).replace(/[^\n]/g, '')
    const replacement = slots ? `${TEACHER_SLOT_ATTR}="${slot}"${lost}` : lost
    const next = attrs.slice(0, answer.start) + replacement + attrs.slice(answer.end)
    edits.push({ start, end: start + m[0].length, text: `<blank${next}>` })
  }

  if (edits.length === 0) return { content, solutions, answers }
  edits.sort((a, b) => a.start - b.start)
  let out = ''
  let at = 0
  for (const e of edits) {
    out += content.slice(at, e.start) + e.text
    at = e.end
  }
  return { content: out + content.slice(at), solutions, answers }
}

/** The markdown as everyone but the page's authors gets it. */
export function publicContent(content: string): string {
  return stripTeacherContent(content).content
}
