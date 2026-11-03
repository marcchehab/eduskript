/**
 * Source edits made from the print preview (print-edit-overlay.tsx): print
 * widths of images and drawings, print heights of spacers, page breaks. Pure string functions on the
 * page markdown, keyed by 1-based source lines (data-source-line-start/end).
 *
 * Saved through /api/pages/[id]/replace as a changed line range with
 * non-blank context lines around it (lineRangeEdit), so the server can check
 * that those lines are still where the client saw them.
 *
 * Limitations:
 * - An image is looked up by file name within its element's source lines.
 *   Zero or several matches there (e.g. the same file twice on one line, a
 *   reference-style image) → null, the caller shows an error instead of
 *   editing a guess.
 * - Fences are not checked: the lines come from the rendered element, which
 *   is never inside a fence.
 */

import { decodeFileRef } from '@/lib/file-refs'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function lineOffset(content: string, line: number): number {
  let at = 0
  for (let i = 1; i < line; i++) {
    const nl = content.indexOf('\n', at)
    if (nl === -1) return -1
    at = nl + 1
  }
  return at
}

const eolOf = (content: string) => (content.includes('\r\n') ? '\r\n' : '\n')

/** `print-width` value, normalized: "60%" → "60%", "60" → "60%"; null when invalid. */
export function normalizePrintWidth(value: string | number): string | null {
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${Math.round(Math.min(n, 100))}%`
}

export interface ImageRef {
  /** 'image' = <img> or ![](…); 'drawing' = <excali> or ![](….excalidraw). */
  kind: 'image' | 'drawing'
  /** File name as rendered (data-original-src / excalidraw filename). */
  src: string
  /** Element's source lines, 1-based, inclusive. */
  startLine: number
  endLine?: number
}

// Tag with attribute values that may contain `>`.
const TAG_RE = /<(excali|img)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>/g
// ![alt](src "title"){attrs}: alt may hold [..] and escapes; title "…", '…' or (…).
const mdRe = (forms: string) =>
  new RegExp(`!\\[(?:[^\\]\\\\[]|\\\\.|\\[[^\\]]*\\])*\\]\\(\\s*<?(?:${forms})>?(?:\\s+(?:"[^"]*"|'[^']*'|\\([^)]*\\)))?\\s*\\)(\\{[^}\\n]*\\})?`, 'g')

/**
 * Content with the print width of `ref` set, or removed for null. Writes
 * `print-width` on <excali>, `data-print-width` on <img> and
 * `{print-width=60%}` on markdown images. null unless exactly one matching
 * image is in the element's lines.
 */
export function setImagePrintWidth(content: string, ref: ImageRef, value: string | null): string | null {
  const start = lineOffset(content, ref.startLine)
  if (start === -1) return null
  const endAt = lineOffset(content, (ref.endLine ?? ref.startLine) + 1)
  const range = content.slice(start, endAt === -1 ? undefined : endAt)

  const base = ref.src.replace(/\.excalidraw(?:\.md)?$/, '')
  const names = ref.kind === 'drawing'
    ? [base, `${base}.excalidraw`, `${base}.excalidraw.md`]
    : [ref.src]
  const forms = [...new Set(names.flatMap((n) => [n, decodeFileRef(n)]))].map(escapeRe).join('|')
  const tagName = ref.kind === 'drawing' ? 'excali' : 'img'
  const srcAttr = new RegExp(`\\bsrc\\s*=\\s*(["'])(?:${forms})\\1`)

  const hits: { at: number; old: string; next: string }[] = []
  for (const m of range.matchAll(TAG_RE)) {
    if (m[1] !== tagName || !srcAttr.test(m[2])) continue
    const attr = tagName === 'img' ? 'data-print-width' : 'print-width'
    const attrs = m[2].replace(/\s+(?:data-)?print-width\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/g, '')
    const close = m[3] ? ' />' : '>'
    hits.push({ at: m.index!, old: m[0], next: `<${m[1]}${attrs}${value === null ? '' : ` ${attr}="${value}"`}${close}` })
  }
  // Markdown images are matched in the text with tags blanked out, so an
  // `![…](x)` inside an attribute can't count twice.
  const untagged = range.replace(TAG_RE, (t) => ' '.repeat(t.length))
  for (const m of untagged.matchAll(mdRe(forms))) {
    const block = m[1]
    const image = block ? m[0].slice(0, -block.length) : m[0]
    const parts = block ? block.slice(1, -1).split(';').map((p) => p.trim()).filter((p) => p && !/^print-width\b/.test(p)) : []
    if (value !== null) parts.push(`print-width=${value}`)
    hits.push({ at: m.index!, old: m[0], next: image + (parts.length ? `{${parts.join(';')}}` : '') })
  }
  if (hits.length !== 1) return null
  const [hit] = hits
  const at = start + hit.at
  return content.slice(0, at) + hit.next + content.slice(at + hit.old.length)
}

const SPACER_RE = /<spacer\b((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>/g

/**
 * Content with the `print-height` of the <spacer> in lines startLine..endLine
 * set (e.g. "6.5cm"), or removed for null. null unless exactly one spacer is
 * in those lines.
 */
export function setSpacerPrintHeight(content: string, startLine: number, endLine: number, value: string | null): string | null {
  const start = lineOffset(content, startLine)
  if (start === -1) return null
  const endAt = lineOffset(content, endLine + 1)
  const range = content.slice(start, endAt === -1 ? undefined : endAt)
  const hits = [...range.matchAll(SPACER_RE)]
  if (hits.length !== 1) return null
  const [m] = hits
  const attrs = m[1].replace(/\s+print-height\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/g, '')
  const next = `<spacer${attrs}${value === null ? '' : ` print-height="${value}"`}${m[2] ? ' />' : '>'}`
  const at = start + m.index!
  return content.slice(0, at) + next + content.slice(at + m[0].length)
}

/** Content with `<pagebreak />` and a blank line inserted before `line`; null when out of range. */
export function insertPageBreak(content: string, line: number): string | null {
  const at = lineOffset(content, line)
  if (at === -1) return null
  const eol = eolOf(content)
  // Keep the break its own block: blank line before it unless at the start.
  const before = content.slice(0, at)
  const lead = before === '' || before.endsWith(eol + eol) ? '' : eol
  return `${before}${lead}<pagebreak />${eol}${eol}${content.slice(at)}`
}

/** Content without the `<pagebreak />` on `line` (and one blank line after it); null when none there. */
export function removePageBreak(content: string, line: number): string | null {
  const at = lineOffset(content, line)
  if (at === -1) return null
  const m = /^[ \t]*<pagebreak\b[^>]*\/?>[ \t]*(?:<\/pagebreak>)?[ \t]*(?:\r?\n[ \t]*\r?\n|\r?\n|$)/.exec(content.slice(at))
  if (!m) return null
  return content.slice(0, at) + content.slice(at + m[0].length)
}

const blank = (s: string) => !s.trim()

/**
 * The changed whole-line range between `before` and `after`, widened by one
 * unchanged line on each side (more while those are blank), as a replace
 * request: `old` = those lines in `before`, `new` = their replacement,
 * `line` = 1-based first line. The non-blank context makes the server's
 * line check fail when lines above shifted meanwhile, and keeps `old` and
 * `new` non-empty for insertions and deletions.
 */
export function lineRangeEdit(before: string, after: string): { old: string; new: string; line: number } {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  if (head > 0) {
    head--
    while (head > 0 && blank(a[head])) head--
  }
  if (tail > 0) {
    tail--
    while (tail > 0 && blank(a[a.length - 1 - tail])) tail--
  }
  return {
    old: a.slice(head, a.length - tail).join('\n'),
    new: b.slice(head, b.length - tail).join('\n'),
    line: head + 1,
  }
}
