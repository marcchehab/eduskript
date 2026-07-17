/**
 * Extracts the context for an <ai-feedback> request from raw page markdown.
 *
 * Scope: the H2 section surrounding the <ai-feedback> tag — from the nearest
 * preceding h1/h2 heading (inclusive) to the next h1/h2 heading or EOF.
 * H3+ headings do NOT bound the section; they are sub-steps of the exercise.
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
  /** The enclosing H2 section's markdown, ai-feedback tags stripped. */
  sectionMarkdown: string
}

const HEADING_RE = /^#{1,2}\s+\S/
const FENCE_RE = /^\s*(```|~~~)/

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
function findTags(lines: string[], inFence: boolean[]): Array<{ line: number; tagText: string }> {
  const tags: Array<{ line: number; tagText: string }> = []
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
    tags.push({ line: i, tagText })
  }
  return tags
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
  let tag: { line: number; tagText: string } | undefined
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

  // Section bounds: nearest h1/h2 at or above the tag line → next h1/h2 below
  let start = 0
  for (let i = tag.line; i >= 0; i--) {
    if (!inFence[i] && HEADING_RE.test(lines[i])) {
      start = i
      break
    }
  }
  let end = lines.length
  for (let i = tag.line + 1; i < lines.length; i++) {
    if (!inFence[i] && HEADING_RE.test(lines[i])) {
      end = i
      break
    }
  }

  const sectionMarkdown = lines
    .slice(start, end)
    .join('\n')
    // Strip ai-feedback tags (self-closing or paired) so the model doesn't
    // see the teacher prompt duplicated inside the exercise text.
    .replace(/<ai-feedback\b[^>]*>/gi, '')
    .replace(/<\/ai-feedback>/gi, '')
    .trim()

  return { prompt, sectionMarkdown }
}
