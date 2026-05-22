import type { Element, Root } from 'hast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'

/**
 * Rewrites `<left>`, `<center>`, `<right>` elements to `<div class="es-align-{name}">`.
 *
 * Authors write block-level alignment as plain HTML so a stray `:` in body
 * text doesn't collide with `remark-directive` (which used to drive this).
 *
 * Must run BEFORE rehypeSanitize so the resulting `<div>` is what the
 * sanitizer sees — that way we only need `left`/`center`/`right` in the
 * tag-name allowlist; their attributes don't matter (we discard them).
 */

const ALIGN_TAGS = new Set(['left', 'center', 'right'])

export const rehypeAlignTags: Plugin<[], Root> = function () {
  return function (tree: Root) {
    visit(tree, 'element', (node: Element) => {
      if (!ALIGN_TAGS.has(node.tagName)) return
      const name = node.tagName
      node.tagName = 'div'
      node.properties = {
        ...(node.properties || {}),
        className: ['es-align-' + name],
      }
    })
  }
}

export default rehypeAlignTags
