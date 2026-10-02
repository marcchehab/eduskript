/**
 * Where and how to insert a block snippet (quiz, callout, code editor, …)
 * from the editor's Insert ribbon so it never lands inside existing markup.
 *
 * Rules (pure string logic, O(n) in doc length because of the slices):
 * - Cursor on a blank line or at the start of a line → insert there.
 * - Cursor mid-line → insert after the end of that line. If the line is part
 *   of a blockquote/callout (`>` prefix), skip to the end of that `>` run so
 *   the callout is not split.
 * - The template's own leading/trailing newlines are dropped; we add exactly
 *   enough newlines for one blank line before and after the block (none at
 *   the very start of the doc, a single trailing newline at the end).
 *
 * Used by src/components/dashboard/codemirror-editor.tsx (CodeMirror and the
 * simple-textarea fallback). It does not look at fenced code or HTML context:
 * a cursor inside a ``` fence still gets the block inserted after that line.
 */
export interface BlockInsertPlan {
  /** Doc offset to insert at (pure insertion, nothing replaced). */
  from: number
  /** Text to insert. */
  insert: string
  /** Offset (in the new doc) where the template body starts. */
  bodyStart: number
  /** Suggested cursor offset (in the new doc): the line after the block. */
  cursor: number
}

export function planBlockInsert(doc: string, pos: number, template: string): BlockInsertPlan {
  const lineFrom = doc.lastIndexOf('\n', pos - 1) + 1
  const lineEnd = (from: number) => {
    const i = doc.indexOf('\n', from)
    return i === -1 ? doc.length : i
  }
  let lineTo = lineEnd(lineFrom)
  const lineText = doc.slice(lineFrom, lineTo)

  let at: number
  if (lineText.trim() === '' || pos === lineFrom) {
    at = lineFrom
  } else {
    at = lineTo
    if (lineText.trimStart().startsWith('>')) {
      // Extend over the rest of the blockquote/callout.
      while (lineTo < doc.length && doc.slice(lineTo + 1, lineEnd(lineTo + 1)).trimStart().startsWith('>')) {
        lineTo = lineEnd(lineTo + 1)
      }
      at = lineTo
    }
  }

  const body = template.replace(/^\n+/, '').replace(/\n+$/, '')
  const before = doc.slice(0, at)
  const after = doc.slice(at)

  const trailingNl = before.match(/\n*$/)![0].length
  const prefix = before.trim() === '' ? '' : '\n'.repeat(Math.max(0, 2 - trailingNl))
  const leadingNl = after.match(/^\n*/)![0].length
  const suffix = after.trim() === ''
    ? (leadingNl >= 1 ? '' : '\n')
    : '\n'.repeat(Math.max(0, 2 - leadingNl))

  const bodyStart = at + prefix.length
  const cursor = bodyStart + body.length + ((suffix + after).startsWith('\n') ? 1 : 0)
  return { from: at, insert: prefix + body + suffix, bodyStart, cursor }
}
