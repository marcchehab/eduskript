/**
 * Normalize markdown content so that diffs against author-saved content
 * don't show spurious changes from cosmetic differences.
 *
 * The AI sometimes returns text with:
 *   - Windows-style line endings (`\r\n`) where the original has Unix (`\n`)
 *   - Trailing whitespace on lines (invisible but bytewise different)
 *   - A different number of trailing newlines
 *   - Unicode characters in different normalization forms (precomposed vs
 *     decomposed accents) — visually identical, bytewise different
 *
 * Each of these can produce huge "delete + re-add" diff chunks even when
 * the content is functionally unchanged. This helper applies the same
 * normalization the markdown editor effectively does on save, so the
 * before/after baseline matches.
 *
 * Used by:
 *   - the AI edit endpoint (normalizes proposed content before storing)
 *   - the MergeEditor (defensive — handles old content that wasn't
 *     normalized at write time)
 */
export function normalizeContent(input: string): string {
  if (!input) return ''

  let s = input

  // Strip BOM if present.
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)

  // Unicode NFC: combine decomposed accents (e.g. "é" as `e + ́` → `é`).
  s = s.normalize('NFC')

  // Normalize line endings to LF.
  s = s.replace(/\r\n?/g, '\n')

  // Strip trailing whitespace on every line (invisible but breaks byte-diffs).
  s = s.replace(/[ \t]+$/gm, '')

  // Collapse multiple trailing newlines into exactly one. Empty input stays
  // empty — don't add a newline to a truly blank file.
  s = s.replace(/\n+$/, '')
  if (s.length > 0) s += '\n'

  return s
}
