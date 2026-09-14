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
  /** Markdown from the preceding h1/h2 up to the tag, ai-feedback blocks stripped. */
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
    .trim()

  return { prompt, sectionMarkdown }
}
