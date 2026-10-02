/**
 * Pure inline-formatting edits for the markdown editor (codemirror-editor.tsx).
 *
 * Each function takes the document text and the main selection and returns a
 * change + new selection, or null when there is nothing to do. The editor
 * dispatches the result; the ribbon buttons and the keyboard shortcuts
 * (Ctrl/Cmd+B, I, E, Shift+X, K) share these functions.
 *
 * Bold/italic/inline-code use an mdast parse of the WHOLE document on every
 * call (O(n) in document length) to detect an enclosing node. Strikethrough
 * is a text check only (the GFM mdast extension is not a direct dependency):
 * it unwraps only when `~~` directly surrounds or is part of the selection.
 */
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Parent } from 'mdast'

export interface FormatEdit {
  changes: { from: number; to: number; insert: string }
  selection: { anchor: number; head: number }
}

type NodeType = 'strong' | 'emphasis' | 'inlineCode'

/** Innermost-first search for a node of `nodeType` whose range contains `pos`. */
export function findEnclosingNode(
  doc: string,
  pos: number,
  nodeType: NodeType
): { start: number; end: number } | null {
  try {
    const tree = fromMarkdown(doc)
    const findNode = (parent: Parent): { start: number; end: number } | null => {
      for (const child of parent.children) {
        if (!child.position) continue
        const start = child.position.start.offset ?? 0
        const end = child.position.end.offset ?? 0
        if (pos < start || pos > end) continue
        if ('children' in child) {
          const inner = findNode(child as Parent)
          if (inner) return inner
        }
        if (child.type === nodeType) return { start, end }
      }
      return null
    }
    return findNode(tree)
  } catch {
    return null
  }
}

const isWordChar = (c: string) => /\w/.test(c) || /[À-ɏḀ-ỿ]/.test(c)

/** Expand an empty selection inside a word to the whole word. */
export function expandToWord(doc: string, from: number, to: number): { from: number; to: number } {
  if (from !== to) return { from, to }
  const before = from > 0 ? doc[from - 1] : ''
  const after = from < doc.length ? doc[from] : ''
  if (!isWordChar(before) || !isWordChar(after)) return { from, to }
  let start = from
  while (start > 0 && isWordChar(doc[start - 1])) start--
  let end = from
  while (end < doc.length && isWordChar(doc[end])) end++
  return { from: start, to: end }
}

function wrap(doc: string, from: number, to: number, open: string, close = open): FormatEdit {
  const r = expandToWord(doc, from, to)
  return {
    changes: { from: r.from, to: r.to, insert: `${open}${doc.slice(r.from, r.to)}${close}` },
    selection: { anchor: r.from + open.length, head: r.to + open.length },
  }
}

function unwrap(doc: string, start: number, end: number, markerLen: number, from: number, to: number): FormatEdit {
  const innerStart = start + markerLen
  const innerEnd = end - markerLen
  // Map the old selection into the unwrapped text, clamped to the inner range
  const map = (p: number) => Math.min(Math.max(p, innerStart), innerEnd) - markerLen
  return {
    changes: { from: start, to: end, insert: doc.slice(innerStart, innerEnd) },
    selection: { anchor: map(from), head: map(to) },
  }
}

/**
 * Toggle **bold**, *italic* or `code`. Inside an existing node: remove it.
 * Otherwise wrap the selection (or the word under the cursor). With an empty
 * selection outside a word, inserts the empty markers with the cursor between.
 */
export function toggleInline(doc: string, from: number, to: number, nodeType: NodeType): FormatEdit {
  const marker = nodeType === 'strong' ? '**' : nodeType === 'emphasis' ? '*' : '`'
  const n = marker.length
  // Second press on freshly inserted empty markers (`**|**`): remove them.
  // Neighbour check keeps italic from eating half of an empty bold pair.
  if (from === to && doc.slice(from - n, from) === marker && doc.slice(from, from + n) === marker
      && doc[from - n - 1] !== marker[0] && doc[from + n] !== marker[0]) {
    return { changes: { from: from - n, to: from + n, insert: '' }, selection: { anchor: from - n, head: from - n } }
  }
  const enclosing = findEnclosingNode(doc, from, nodeType)
  if (enclosing && to <= enclosing.end) {
    let markerLen: number
    if (nodeType === 'inlineCode') {
      markerLen = 0
      while (doc[enclosing.start + markerLen] === '`') markerLen++
    } else {
      markerLen = nodeType === 'strong' ? 2 : 1
    }
    return unwrap(doc, enclosing.start, enclosing.end, markerLen, from, to)
  }
  return wrap(doc, from, to, marker)
}

/** Toggle ~~strikethrough~~ (text-based, see file header). */
export function toggleStrikethrough(doc: string, from: number, to: number): FormatEdit {
  const m = '~~'
  if (doc.slice(from - 2, from) === m && doc.slice(to, to + 2) === m) {
    return unwrap(doc, from - 2, to + 2, 2, from, to)
  }
  const sel = doc.slice(from, to)
  if (sel.length >= 4 && sel.startsWith(m) && sel.endsWith(m)) {
    return {
      changes: { from, to, insert: sel.slice(2, -2) },
      selection: { anchor: from, head: to - 4 },
    }
  }
  return wrap(doc, from, to, m)
}

/**
 * Insert a link. Selected text becomes the label and the `url` placeholder is
 * selected; a selected URL becomes the target and the cursor goes into the
 * empty label; with no selection inserts `[](url)` with the cursor in `[]`.
 */
export function insertLink(doc: string, from: number, to: number): FormatEdit {
  const sel = doc.slice(from, to)
  if (/^(https?:\/\/|www\.)\S+$/.test(sel)) {
    return {
      changes: { from, to, insert: `[](${sel})` },
      selection: { anchor: from + 1, head: from + 1 },
    }
  }
  const insert = `[${sel}](url)`
  if (!sel) return { changes: { from, to, insert }, selection: { anchor: from + 1, head: from + 1 } }
  const urlStart = from + sel.length + 3
  return { changes: { from, to, insert }, selection: { anchor: urlStart, head: urlStart + 3 } }
}
