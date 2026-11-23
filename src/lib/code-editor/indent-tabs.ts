/**
 * Tab characters in Python indentation (student code editor,
 * src/components/public/code-editor/index.tsx).
 *
 * The editor's Tab and Enter keys already indent with 4 spaces (indentUnit),
 * but tabs arrive through pasted code (Thonny, IDLE, Teams, web pages) and
 * through starter code or saved answers that contain them. Once one line
 * starts with a tab, Enter continues it with spaces up to the same column and
 * Python fails with TabError (inconsistent use of tabs and spaces). So:
 * - {@link pythonIndentTabs}: every transaction that inserts a tab into a
 *   line's indentation gets that tab expanded to spaces (paste, drop, loading
 *   starter code / saved answers). The editor's initial doc goes through
 *   {@link expandIndentTabs} directly.
 * Since every way in (initial doc + all transactions) is covered, no tab can
 * stay in the indentation, so there is no linter for it. Tabs after the first
 * non-blank character (inside strings, comments) are left alone.
 * Spaces and tabs are made visible with highlightWhitespace() (index.tsx).
 */

import { EditorState, type Extension, type Transaction, type TransactionSpec } from '@codemirror/state'

const LEADING_WS = /^[ \t]*/

/** Expands tabs in the indentation of one line to the next multiple of `tabSize`. */
function expandLine(line: string, tabSize: number): string {
  const lead = LEADING_WS.exec(line)![0]
  if (!lead.includes('\t')) return line
  let col = 0
  for (const ch of lead) col = ch === '\t' ? col + tabSize - (col % tabSize) : col + 1
  return ' '.repeat(col) + line.slice(lead.length)
}

/** Expands tabs in every line's indentation. O(length). */
export function expandIndentTabs(text: string, tabSize = 4): string {
  if (!text.includes('\t')) return text
  return text.split('\n').map(line => expandLine(line, tabSize)).join('\n')
}

/** Changes (in `tr.newDoc` positions) that expand tabs in the indentation of the lines `tr` touched. */
function expandTouchedLines(tr: Transaction, tabSize: number): TransactionSpec | null {
  const doc = tr.newDoc
  const changes: { from: number; to: number; insert: string }[] = []
  const seen = new Set<number>()
  tr.changes.iterChangedRanges((_fA, _tA, fromB, toB) => {
    const first = doc.lineAt(fromB).number
    const last = doc.lineAt(toB).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = doc.line(n)
      const lead = LEADING_WS.exec(line.text)![0]
      if (lead.includes('\t')) {
        changes.push({ from: line.from, to: line.from + lead.length, insert: expandLine(lead, tabSize) })
      }
    }
  })
  return changes.length ? { changes, sequential: true } : null
}

/**
 * Python only: tabs inserted into indentation become spaces in the same
 * transaction (the follow-up changes are expressed in the new document and
 * applied right after, so undo reverts both together).
 */
export function pythonIndentTabs(tabSize = 4): Extension {
  return EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged) return tr
    let inserted = false
    tr.changes.iterChanges((_fA, _tA, _fB, _tB, text) => {
      if (!inserted && text.toString().includes('\t')) inserted = true
    })
    if (!inserted) return tr
    const fix = expandTouchedLines(tr, tabSize)
    return fix ? [tr, fix] : tr
  })
}
