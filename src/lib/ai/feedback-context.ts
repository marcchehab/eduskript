/**
 * Extracts the context for an <ai-feedback> request from raw page markdown.
 *
 * Scope: everything ABOVE the <ai-feedback> tag, back to the nearest
 * preceding h1/h2 heading (inclusive) or page start. Nothing below the tag is
 * included, so content placed after the button (an example answer, the next
 * exercise) never reaches the model. H3+ do not bound the context; with
 * several tags under one h2, each later tag sees the earlier ones' text too.
 *
 * Other <ai-feedback> blocks in that range are removed entirely (tag and any
 * inner content); the requested tag's own prompt is returned separately.
 *
 * Reference solutions: `<solution>` blocks are not exercise text. They are
 * removed from sectionMarkdown and the tag's own ones are returned in
 * `solutions` (linkedSolutions below): a <solution> belongs to the last
 * <ai-feedback> above it in the same h1/h2 section, or, with none above, to
 * the first one below it. So "exercise, ai-feedback, solution" and
 * "exercise, solution, ai-feedback" both link; solutions BELOW the tag reach
 * the model this way, unlike other content below it.
 *
 * Runs server-side so students can't tamper with the teacher prompt or the
 * exercise text: the client only sends pageId + feedbackId, the server
 * re-derives everything from the stored page content.
 *
 * Limitations:
 * - Fence tracking is line-based (``` or ~~~ at line start toggles). Headings
 *   inside fenced code blocks are ignored; exotic nesting (fences inside
 *   callouts) is not modeled.
 * - Tag attributes must use double quotes (matches how all other components
 *   are documented in the syntax reference).
 *
 * @see src/components/markdown/ai-feedback.tsx - client component
 * @see src/app/api/ai/feedback/route.ts - consumer
 */

export interface FeedbackContext {
  /** Teacher prompt from the tag's prompt="..." attribute, if any. */
  prompt: string | null
  /**
   * Teacher's reference solution file from solution="...", if any. Never sent
   * to the client; loaded server-side by feedback-solution.ts.
   */
  solution: string | null
  /** Maximum from points="...": the model also gives a score. See feedback-marks.ts */
  points: number | null
  /** Markdown from the preceding h1/h2 up to the tag, ai-feedback and solution blocks stripped. */
  sectionMarkdown: string
  /** <solution> blocks linked to this tag, in source order. */
  solutions: LinkedSolution[]
}

export interface LinkedSolution {
  /** Inner markdown of the block. */
  markdown: string
  title: string | null
  /** <solution hidden>: never shown to students, so the model must not reveal it. */
  hidden: boolean
  /** 0-based line of the opening tag. */
  line: number
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i

/** Whether a solution name is an image file (else an Excalidraw drawing name). */
export function isSolutionImageFile(name: string): boolean {
  return IMAGE_EXT_RE.test(name.trim())
}

/**
 * Map a solution="..." value to the stored filename:
 * - image extension (png/jpg/jpeg/webp/gif/svg) → that file as-is
 * - anything else → an Excalidraw drawing: `<name>.excalidraw.light.svg`
 *   (`.excalidraw` suffix optional, same as <excali src>)
 * Shared by the loader (feedback-solution.ts) and page copy/move
 * (extract-file-references.ts), so both agree on which file is meant.
 */
export function solutionFilename(name: string): string {
  const trimmed = name.trim()
  if (IMAGE_EXT_RE.test(trimmed)) return trimmed
  return `${trimmed.replace(/\.excalidraw(\.md)?$/, '')}.excalidraw.light.svg`
}

const HEADING_RE = /^#{1,2}\s+\S/
// Fences inside blockquotes/callouts ("> ```") count too: the "show source"
// callouts hold example <ai-feedback> tags that must not be counted as tags.
const FENCE_RE = /^\s*(?:>\s*)*(```|~~~)/

/** Line indices that are inside fenced code blocks (exclusive of fences). */
function fencedLines(lines: string[]): boolean[] {
  const inFence: boolean[] = new Array(lines.length).fill(false)
  let open = false
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      open = !open
      inFence[i] = true // fence delimiters themselves never count as headings
    } else {
      inFence[i] = open
    }
  }
  return inFence
}

/**
 * Collect all ai-feedback opening tags (text + start line), in source order.
 * Tags may span multiple lines; we join until the closing `>`.
 */
function findTags(lines: string[], inFence: boolean[]): Array<{ line: number; col: number; tagText: string }> {
  const tags: Array<{ line: number; col: number; tagText: string }> = []
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue
    const col = lines[i].search(/<ai-feedback\b/i)
    if (col === -1) continue

    // Join lines until the tag closes (bounded to avoid runaway on broken markup)
    let tagText = lines[i].slice(col)
    let j = i
    while (!tagText.includes('>') && j < Math.min(i + 10, lines.length - 1)) {
      j++
      tagText += '\n' + lines[j]
    }
    const end = tagText.indexOf('>')
    if (end !== -1) tagText = tagText.slice(0, end + 1)
    tags.push({ line: i, col, tagText })
  }
  return tags
}

const SOLUTION_OPEN_RE = /<solution\b([^>]*)>/i
const SOLUTION_CLOSE_RE = /<\/solution>/i

/** <solution>…</solution> blocks outside fences. Unclosed blocks run to the end. */
function findSolutions(lines: string[], inFence: boolean[]): LinkedSolution[] {
  const out: LinkedSolution[] = []
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue
    const open = lines[i].match(SOLUTION_OPEN_RE)
    if (!open || open.index === undefined) continue
    const attrs = open[1]
    const parts: string[] = []
    let rest = lines[i].slice(open.index + open[0].length)
    let j = i
    for (;;) {
      const close = rest.search(SOLUTION_CLOSE_RE)
      if (close !== -1) { parts.push(rest.slice(0, close)); break }
      parts.push(rest)
      if (++j >= lines.length) break
      rest = lines[j]
    }
    out.push({
      markdown: parts.join('\n').trim(),
      title: attrs.match(/\btitle\s*=\s*"([^"]*)"/i)?.[1] ?? null,
      hidden: /(^|\s)hidden(\s|=|\/|$)/i.test(attrs),
      line: i,
    })
    i = j
  }
  return out
}

/** Index of the h1/h2 section (count of headings at or above `line`). */
function sectionOf(line: number, headings: number[]): number {
  let k = 0
  while (k < headings.length && headings[k] <= line) k++
  return k
}

function headingLines(lines: string[], inFence: boolean[]): number[] {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) if (!inFence[i] && HEADING_RE.test(lines[i])) out.push(i)
  return out
}

/**
 * The <solution> blocks belonging to the <ai-feedback> tag on 0-based line
 * `tagLine`: in the same h1/h2 section, owned by the last tag above them, or
 * by the first tag below when none is above. O(solutions × tags).
 * Also used by the editor gizmo (ai-feedback-solution-gizmo.tsx), so the
 * editor shows exactly what the server sends.
 */
export function linkedSolutions(content: string, tagLine: number): LinkedSolution[] {
  const lines = content.split('\n')
  const inFence = fencedLines(lines)
  return linkedSolutionsIn(lines, inFence, findTags(lines, inFence).map((t) => t.line), tagLine)
}

function linkedSolutionsIn(lines: string[], inFence: boolean[], tagLines: number[], tagLine: number): LinkedSolution[] {
  const headings = headingLines(lines, inFence)
  const section = sectionOf(tagLine, headings)
  const tagsHere = tagLines.filter((l) => sectionOf(l, headings) === section)
  return findSolutions(lines, inFence).filter((sol) => {
    if (sectionOf(sol.line, headings) !== section) return false
    const above = tagsHere.filter((l) => l < sol.line)
    const owner = above.length ? above[above.length - 1] : tagsHere.find((l) => l > sol.line)
    return owner === tagLine
  })
}

/**
 * @param feedbackId - match by tag id when given (explicit override)
 * @param feedbackIndex - otherwise pick the nth tag in source order. The
 *   client derives this from DOM order of rendered components, which matches
 *   source order. Falls back to the first tag.
 */
export function extractFeedbackContext(
  content: string,
  feedbackId?: string | null,
  feedbackIndex?: number | null
): FeedbackContext | null {
  const lines = content.split('\n')
  const inFence = fencedLines(lines)

  const tags = findTags(lines, inFence)
  let tag: { line: number; col: number; tagText: string } | undefined
  if (feedbackId) {
    tag = tags.find((t) => {
      const idMatch = t.tagText.match(/\bid\s*=\s*"([^"]*)"/i)
      return idMatch?.[1] === feedbackId
    })
  } else if (typeof feedbackIndex === 'number' && feedbackIndex >= 0) {
    tag = tags[feedbackIndex]
  } else {
    tag = tags[0]
  }
  if (!tag) return null

  const promptMatch = tag.tagText.match(/\bprompt\s*=\s*"([^"]*)"/i)
  const prompt = promptMatch ? promptMatch[1] : null
  const solutionMatch = tag.tagText.match(/\bsolution\s*=\s*"([^"]*)"/i)
  const solution = solutionMatch?.[1].trim() || null

  // Context bounds: nearest h1/h2 at or above the tag line → the tag itself
  let start = 0
  for (let i = tag.line; i >= 0; i--) {
    if (!inFence[i] && HEADING_RE.test(lines[i])) {
      start = i
      break
    }
  }

  const sectionMarkdown = [...lines.slice(start, tag.line), lines[tag.line].slice(0, tag.col)]
    .join('\n')
    // Drop earlier ai-feedback blocks: paired ones with their inner content,
    // then self-closing/unclosed opening tags (their prompts would otherwise
    // leak another exercise's grading instructions into this request).
    .replace(/<ai-feedback\b[^>]*[^/]>[\s\S]*?<\/ai-feedback>/gi, '')
    .replace(/<ai-feedback\b[^>]*>/gi, '')
    .replace(/<\/ai-feedback>/gi, '')
    // Solutions go to the model separately (`solutions`), marked as such.
    .replace(/<solution\b[^>]*>[\s\S]*?(<\/solution>|$)/gi, '')
    .trim()

  const pointsMatch = tag.tagText.match(/\bpoints\s*=\s*"(\d+(?:\.\d+)?)"/i)
  const points = pointsMatch ? Number(pointsMatch[1]) : null

  const solutions = linkedSolutionsIn(lines, inFence, tags.map((t) => t.line), tag.line)

  return { prompt, solution, points, sectionMarkdown, solutions }
}
