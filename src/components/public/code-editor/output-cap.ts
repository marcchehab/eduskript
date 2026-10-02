/**
 * Caps the code editor output panel to the last MAX_OUTPUT_LINES lines so a
 * runaway print loop doesn't render megabytes into the DOM and stall the tab.
 *
 * Applies to every addOutput() call (Python/Skulpt, Pyodide, JS, SQL), which
 * all funnel through code-editor/index.tsx `addOutput`.
 *
 * "Lines" are counted per entry: '\n'-separated lines of the message (a trailing
 * newline does not start a new line); HTML/SQL-table entries count as one line
 * and are dropped whole, never trimmed. When anything is dropped, a single
 * WARNING entry with `truncationNotice: true` sits at index 0.
 *
 * Cost per append: O(entries kept) ≤ O(MAX_OUTPUT_LINES) for the backward scan
 * plus one array copy, independent of how much was printed in total.
 */
import { OutputLevel, type OutputEntry } from './types'

export const MAX_OUTPUT_LINES = 2000
export const TRUNCATION_MESSAGE = `Output truncated — showing last ${MAX_OUTPUT_LINES} lines`

const isTrimmable = (e: OutputEntry) => !e.isHtml && !e.sqlResults

function countLines(e: OutputEntry): number {
  if (!isTrimmable(e)) return 1
  const m = e.message
  let n = 1
  for (let i = 0; i < m.length - 1; i++) if (m.charCodeAt(i) === 10) n++
  return n
}

function lastLines(message: string, n: number): string {
  const trailing = message.endsWith('\n')
  const parts = (trailing ? message.slice(0, -1) : message).split('\n')
  return parts.slice(-n).join('\n') + (trailing ? '\n' : '')
}

export function appendOutputCapped(prev: OutputEntry[], next: OutputEntry): OutputEntry[] {
  const notice = prev[0]?.truncationNotice ? prev[0] : null
  const all = notice ? [...prev.slice(1), next] : [...prev, next]

  let lines = 0
  let i = all.length - 1
  for (; i >= 0; i--) {
    const n = countLines(all[i])
    if (lines + n > MAX_OUTPUT_LINES) break
    lines += n
  }
  if (i < 0) return notice ? [notice, ...all] : all

  const kept = all.slice(i + 1)
  const room = MAX_OUTPUT_LINES - lines
  if (room > 0 && isTrimmable(all[i])) {
    kept.unshift({ ...all[i], message: lastLines(all[i].message, room) })
  }
  return [
    notice ?? { message: TRUNCATION_MESSAGE, level: OutputLevel.WARNING, timestamp: next.timestamp, truncationNotice: true },
    ...kept,
  ]
}
