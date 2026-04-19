/**
 * Rewrite known palette colors found in inline `style` attributes to
 * `es-color-*` / `es-bg-*` class names so they pick up theme-aware
 * CSS variables in `globals.css`.
 *
 * Catches three sources at once:
 *   - KaTeX `\textcolor{cyan}{…}` → `<span style="color: cyan">…</span>`
 *   - Author-written `<span style="color: cyan">…</span>`
 *   - Old toolbar output `<span style="color: #9333ea">…</span>` (via hex
 *     aliases in color-palette.ts)
 *
 * Anything not in the palette (unknown name or unaliased hex) is left alone —
 * the inline color still renders, just without theme awareness. This is the
 * right escape hatch for the toolbar's "custom hex" picker.
 */
import { visit } from 'unist-util-visit'
import type { Element, Properties, Root } from 'hast'
import { resolveHighlightColor, resolveTextColor } from '@/lib/color-palette'

// CSS declaration matching is intentionally loose: handles any whitespace,
// optional trailing semicolon, and case-insensitive property names. The value
// capture stops at the next `;` or end-of-string. Background-color uses a
// negative lookbehind on `-` so it doesn't also match `color:` declarations
// that happen to be preceded by `background-`.
const COLOR_DECL = /(?<![a-z-])color\s*:\s*([^;]+?)\s*(?:;|$)/i
const BG_DECL = /background-color\s*:\s*([^;]+?)\s*(?:;|$)/i

function addClass(properties: Properties, cls: string) {
  const existing = properties.className
  if (Array.isArray(existing)) {
    if (!existing.includes(cls)) existing.push(cls)
  } else if (typeof existing === 'string') {
    properties.className = existing.split(/\s+/).includes(cls)
      ? existing
      : `${existing} ${cls}`
  } else {
    properties.className = [cls]
  }
}

function rewriteOne(node: Element): void {
  const props = node.properties
  if (!props) return
  const style = props.style
  if (typeof style !== 'string' || style.length === 0) return

  let nextStyle = style
  let touched = false

  const colorMatch = COLOR_DECL.exec(nextStyle)
  if (colorMatch) {
    const resolved = resolveTextColor(colorMatch[1])
    if (resolved) {
      addClass(props, `es-color-${resolved}`)
      nextStyle = nextStyle.replace(COLOR_DECL, '')
      touched = true
    }
  }

  const bgMatch = BG_DECL.exec(nextStyle)
  if (bgMatch) {
    const resolved = resolveHighlightColor(bgMatch[1])
    if (resolved) {
      addClass(props, `es-bg-${resolved}`)
      nextStyle = nextStyle.replace(BG_DECL, '')
      touched = true
    }
  }

  if (!touched) return

  const cleaned = nextStyle.replace(/^[\s;]+|[\s;]+$/g, '').replace(/;\s*;/g, ';')
  if (cleaned.length === 0) {
    delete props.style
  } else {
    props.style = cleaned
  }
}

export function rehypeColorClasses() {
  return (tree: Root) => {
    visit(tree, 'element', rewriteOne)
  }
}
