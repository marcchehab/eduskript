/**
 * Splits a page's markdown source into per-slide chunks for the "present as
 * slides" view (see SlidePresenter). Mirrors `splitStages` (markdown-stages.ts):
 * a line-by-line, fence-aware pass at the top level. The split happens on the
 * RAW source before `preprocessMarkdown`, so the same content renders as a
 * normal scroll OR as slides depending only on which path consumes it.
 *
 * Slide breaks:
 *   ---     visible divider — also renders as an <hr> in the scroll view
 *   ---/    invisible divider — renders nothing in the scroll view
 *   # / ##  a level-1 or level-2 heading starts a new slide (heading kept)
 *
 * Exclusion:
 *   ---x    ends the current slide and DROPS everything up to the next break
 *           from the deck. The excluded text still renders in the scroll view —
 *           `stripSlideDirectives` only blanks the marker line, not the body.
 *
 * Empty slides (adjacent breaks, a leading/trailing divider, a divider right
 * before a heading) are coalesced away.
 *
 * Known edge case: a `---` directly under a paragraph with no blank line is a
 * CommonMark setext H2 underline in the scroll view, but here it still splits.
 * Authors blank-line their dividers in practice, so we don't special-case it.
 */

const FENCE_LINE = /^\s*(```|~~~)/
/** Three-or-more dashes only — a CommonMark thematic break. */
const HR_BREAK = /^\s*-{3,}\s*$/
const INVISIBLE_BREAK = /^\s*---\/\s*$/
const EXCLUDE = /^\s*---x\s*$/
const HEADING_BREAK = /^\s*#{1,2}\s/

export interface SplitSlidesResult {
  slides: string[]
  /**
   * `startLines[i]` is the 1-based source line where slide `i` begins, matching
   * the `data-source-line-start` attribute rehypeSourceLine puts on the scroll
   * view. The presenter uses it to open at the slide you're scrolled to.
   */
  startLines: number[]
}

/**
 * The `-{3,}` / `---/` / `---x` regexes are disjoint: the trailing `/`/`x` is
 * not whitespace, so a visible divider never matches an invisible/exclude
 * marker.
 */
export function splitSlides(content: string): SplitSlidesResult {
  const lines = content.split('\n')
  const slides: string[] = []
  const startLines: number[] = []
  let current: string[] = []
  let currentStart = -1
  let excluding = false
  let inFence = false

  const push = (line: string, idx: number) => {
    if (current.length === 0) currentStart = idx
    current.push(line)
  }
  const flush = () => {
    if (current.join('\n').trim() !== '') {
      slides.push(current.join('\n'))
      startLines.push(currentStart + 1) // 1-based, matches data-source-line-start
    }
    current = []
    currentStart = -1
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      if (!excluding) push(line, idx)
      continue
    }
    if (inFence) {
      if (!excluding) push(line, idx)
      continue
    }
    if (EXCLUDE.test(line)) {
      flush()
      excluding = true
    } else if (HR_BREAK.test(line) || INVISIBLE_BREAK.test(line)) {
      flush()
      excluding = false
    } else if (HEADING_BREAK.test(line)) {
      flush()
      excluding = false
      push(line, idx)
    } else if (!excluding) {
      push(line, idx)
    }
  }
  flush()

  return { slides, startLines }
}

/**
 * Blank out the slide directive markers (`---/`, `---x`) so they don't render
 * as literal text in the normal scroll view (they aren't valid thematic breaks
 * because of the trailing `/`/`x`). Leaves `---` untouched (→ <hr>) and never
 * touches excluded *content* — only the marker lines.
 *
 * Line-count-preserving (each marker line becomes an empty line) so the
 * editor↔preview `lineMap` built in `preprocessMarkdown` stays aligned.
 * Fence-aware so a marker shown as example code survives verbatim.
 */
export function stripSlideDirectives(content: string): string {
  const lines = content.split('\n')
  let inFence = false
  return lines
    .map((line) => {
      if (FENCE_LINE.test(line)) {
        inFence = !inFence
        return line
      }
      if (!inFence && (INVISIBLE_BREAK.test(line) || EXCLUDE.test(line))) return ''
      return line
    })
    .join('\n')
}
