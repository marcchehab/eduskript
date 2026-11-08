/**
 * Server side of the print preview's line-based edits
 * (/api/pages/[id]/replace with `line`, client: print-edits.ts lineRangeEdit).
 *
 * The preview edits the public markdown (teacher content stripped,
 * teacher-content.ts publicContent). Stripping keeps the line count, so line
 * numbers match the DB content, but a stripped line itself differs: a
 * `<solution teacher title="…">` opener loses its attributes. lineRangeEdit
 * widens the changed range by one non-blank context line on each side, and
 * that context line is very often such an opener (a spacer right before a
 * teacher solution). Comparing `old` with the DB lines then always failed.
 *
 * So `old` is checked against the DB lines or, failing that, against the
 * public lines. In the public case the unchanged context (common head/tail of
 * `old` and `new`) keeps its DB text and only the changed middle is replaced;
 * a changed middle that touches a stripped line is rejected (null), as before.
 */

import { publicContent } from '@/lib/teacher-content'

/** The content with lines `line`.. replaced, or null when `old` no longer matches. */
export function applyLineRangeEdit(content: string, oldText: string, newText: string, line: number): string | null {
  const full = content.split('\n')
  const oldLines = oldText.split('\n')
  const start = line - 1
  const end = start + oldLines.length
  if (start < 0 || end > full.length) return null

  const fullRange = full.slice(start, end)
  if (fullRange.join('\n') === oldText) {
    return [...full.slice(0, start), newText, ...full.slice(end)].join('\n')
  }

  const pubRange = publicContent(content).split('\n').slice(start, end)
  if (pubRange.length !== oldLines.length || pubRange.join('\n') !== oldText) return null

  const newLines = newText.split('\n')
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++
  let tail = 0
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) tail++

  for (let i = head; i < oldLines.length - tail; i++) {
    if (pubRange[i] !== fullRange[i]) return null // the edit itself touches teacher content
  }

  const merged = [
    ...fullRange.slice(0, head),
    ...newLines.slice(head, newLines.length - tail),
    ...fullRange.slice(oldLines.length - tail),
  ]
  return [...full.slice(0, start), ...merged, ...full.slice(end)].join('\n')
}
