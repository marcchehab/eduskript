/**
 * Find lowercase `<question>` tags without an `id` in page markdown.
 *
 * Such a question gets the componentId `quiz-` (components/markdown/quiz.tsx):
 * all of them on a page share one stored answer, and parseGradableComponents
 * skips them on exam pages. PascalCase `<Question>` is not matched: remarkQuiz
 * gives it a content-hash id.
 *
 * Used by the editor warning (components/dashboard/question-id-lint.ts) and by
 * scripts/add-question-ids.ts. String scan, O(n) in doc length. Known limits:
 * inline code spans are matched per line, so a span across lines is not skipped,
 * and an HTML comment around a question is not recognised.
 */

export interface QuestionWithoutId {
  /** Offset of the `<` of the tag. */
  from: number
  /** Offset after the `>` of the tag. */
  to: number
  /** Offset right after `<question`, where ` id="…"` belongs. */
  idInsertAt: number
}

const TAG_NAME = '<question'
const OPEN_TAG = /<question(?=[\s>])(?:[^>"']|"[^"]*"|'[^']*')*>/g

/** Offset ranges of fenced code blocks and inline code spans. */
function codeRanges(doc: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let offset = 0
  let fence: { char: string; length: number; from: number } | null = null

  for (const line of doc.split('\n')) {
    // The prefix allows fences inside blockquotes and callouts.
    const marker = line.match(/^[ \t>]*(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const closes = marker
        && marker[1][0] === fence.char
        && marker[1].length >= fence.length
        && marker[2].trim() === ''
      if (closes) {
        ranges.push([fence.from, offset + line.length])
        fence = null
      }
    } else if (marker) {
      fence = { char: marker[1][0], length: marker[1].length, from: offset }
    } else {
      for (const span of line.matchAll(/(`+)[^`]+?\1/g)) {
        ranges.push([offset + span.index, offset + span.index + span[0].length])
      }
    }
    offset += line.length + 1
  }
  // An unclosed fence runs to the end of the document.
  if (fence) ranges.push([fence.from, doc.length])
  return ranges
}

export function findQuestionsWithoutId(doc: string): QuestionWithoutId[] {
  const code = codeRanges(doc)
  const found: QuestionWithoutId[] = []
  for (const match of doc.matchAll(OPEN_TAG)) {
    const from = match.index
    if (code.some(([start, end]) => from >= start && from < end)) continue
    // Quoted values removed, so feedback=" id=" does not count as an id.
    const attrs = match[0].replace(/=\s*("[^"]*"|'[^']*')/g, '=')
    if (/\sid\s*=/.test(attrs)) continue
    found.push({ from, to: from + match[0].length, idInsertAt: from + TAG_NAME.length })
  }
  return found
}

/** Inserts an id into every question without one. `makeId` gets the 0-based position among those questions. */
export function addQuestionIds(doc: string, makeId: (index: number) => string): { content: string; ids: string[] } {
  const questions = findQuestionsWithoutId(doc)
  const ids = questions.map((_, index) => makeId(index))
  let content = doc
  // Back to front, so earlier offsets stay valid.
  for (let i = questions.length - 1; i >= 0; i--) {
    const at = questions[i].idInsertAt
    content = `${content.slice(0, at)} id="${ids[i]}"${content.slice(at)}`
  }
  return { content, ids }
}
