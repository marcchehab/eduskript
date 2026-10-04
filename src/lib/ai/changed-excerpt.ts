import { normalizeContent } from './normalize-content'

/**
 * The part of the proposed page worth previewing: the markdown blocks that
 * contain the changed lines, widened to the surrounding blank lines so a
 * callout / list / table is rendered whole. Blank lines inside ``` / ~~~
 * fences don't count as block boundaries. Plain line comparison (common
 * prefix/suffix), so several separate edits collapse into one excerpt from
 * the first to the last — good enough to see the change; the Markdown tab
 * shows the exact diff.
 */
export function changedExcerpt(original: string, proposed: string): { excerpt: string; removedOnly: boolean } {
  const a = normalizeContent(original).split('\n')
  const b = normalizeContent(proposed).split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--
    endB--
  }
  if (endB < start) return { excerpt: '', removedOnly: endA >= start }
  // Prefix/suffix matching can't tell which blank line an insertion "owns";
  // drop blank edge lines so the block widening below starts on content.
  while (start < endB && b[start].trim() === '') start++
  while (endB > start && b[endB].trim() === '') endB--

  // Blank lines outside code fences = safe block boundaries. O(n) over the page.
  const boundary: boolean[] = []
  let inFence = false
  for (const line of b) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    boundary.push(!inFence && line.trim() === '')
  }
  let from = start
  while (from > 0 && !boundary[from - 1]) from--
  let to = endB + 1
  while (to < b.length && !boundary[to]) to++
  return { excerpt: b.slice(from, to).join('\n').trim(), removedOnly: false }
}
