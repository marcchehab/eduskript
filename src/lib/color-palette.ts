/**
 * Theme-aware named color palette — single source of truth shared by:
 *   - The toolbar text-color / highlight-color buttons (emit class names)
 *   - The rehypeColorClasses post-render plugin (rewrites known palette
 *     values found in inline styles to class names)
 *   - The CSS in globals.css (defines `--es-color-*` / `--es-bg-*` tokens
 *     per theme and `.es-color-*` / `.es-bg-*` class rules)
 *
 * Names + light/dark values were chosen from the prod corpus — see the
 * survey results in /home/chris/.claude/plans/. Names are lowercase so they
 * match what authors already type in `\textcolor{NAME}{…}` in KaTeX, which
 * lets legacy content auto-theme via the rewriter.
 */

/** Foreground (text) palette names — class is `es-color-${name}`. */
export const TEXT_COLOR_NAMES = [
  'cyan',
  'lightgreen',
  'green',
  'orange',
  'red',
  'blue',
  'violet',
  'purple',
  'lightblue',
] as const

/** Highlight (background) palette names — class is `es-bg-${name}`. */
export const HIGHLIGHT_COLOR_NAMES = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
  'red',
  'purple',
] as const

export type TextColorName = (typeof TEXT_COLOR_NAMES)[number]
export type HighlightColorName = (typeof HIGHLIGHT_COLOR_NAMES)[number]

/**
 * Hex aliases — old toolbar versions and ad-hoc hex usage that should map to
 * a palette token. Drives the post-render rewriter so legacy content themes
 * without a content migration. Hex keys are lowercase, no whitespace.
 */
export const TEXT_COLOR_HEX_ALIASES: Record<string, TextColorName> = {
  // Old text-color toolbar palette
  '#dc2626': 'red',
  '#2563eb': 'blue',
  '#16a34a': 'green',
  '#9333ea': 'purple', // by far the most common (469 prod uses)
  '#ea580c': 'orange',
}

export const HIGHLIGHT_COLOR_HEX_ALIASES: Record<string, HighlightColorName> = {
  // Old highlight-color toolbar palette
  '#fef08a': 'yellow',
  '#bbf7d0': 'green',
  '#bfdbfe': 'blue',
  '#fbcfe8': 'pink',
  '#fed7aa': 'orange',
  '#fff455': 'yellow', // close cousin used a couple times
  '#4ccd99': 'green',
}

const TEXT_COLOR_SET = new Set<string>(TEXT_COLOR_NAMES)
const HIGHLIGHT_COLOR_SET = new Set<string>(HIGHLIGHT_COLOR_NAMES)

/**
 * Resolve a CSS color value to a palette text-color name, or null if it isn't
 * in the palette. Accepts both bare names (`"cyan"`) and known hex aliases
 * (`"#9333ea"`).
 */
export function resolveTextColor(value: string): TextColorName | null {
  const v = value.trim().toLowerCase()
  if (TEXT_COLOR_SET.has(v)) return v as TextColorName
  if (v in TEXT_COLOR_HEX_ALIASES) return TEXT_COLOR_HEX_ALIASES[v]
  return null
}

export function resolveHighlightColor(value: string): HighlightColorName | null {
  const v = value.trim().toLowerCase()
  if (HIGHLIGHT_COLOR_SET.has(v)) return v as HighlightColorName
  if (v in HIGHLIGHT_COLOR_HEX_ALIASES) return HIGHLIGHT_COLOR_HEX_ALIASES[v]
  return null
}
