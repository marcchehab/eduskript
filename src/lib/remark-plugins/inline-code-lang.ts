import { visit } from 'unist-util-visit'
import type { Root, InlineCode, Text, Parent } from 'mdast'

const LANG_MARKER = /^\{:(\w+)\}/

/**
 * `` `code`{:python} `` — tags inline code with a language so it can be
 * syntax-highlighted (see InlineCodeHighlighted). The marker is a plain text
 * node immediately following the inlineCode node; we splice its match off
 * and carry the language through as `data-lang` (remark-rehype drops
 * anything not in hProperties).
 */
export function remarkInlineCodeLang() {
  return (tree: Root) => {
    visit(tree, 'inlineCode', (node: InlineCode, index, parent: Parent | undefined) => {
      if (!parent || index === undefined) return
      const next = parent.children[index + 1] as Text | undefined
      if (!next || next.type !== 'text') return

      const match = LANG_MARKER.exec(next.value)
      if (!match) return

      next.value = next.value.slice(match[0].length)
      if (next.value === '') parent.children.splice(index + 1, 1)

      const data = (node.data ??= {})
      data.hProperties = { ...(data.hProperties ?? {}), 'data-lang': match[1].toLowerCase() }
    })
  }
}
