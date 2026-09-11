import { visit } from 'unist-util-visit'
import type { Root, Element, ElementContent } from 'hast'

/**
 * Lift block-level custom tags out of the paragraph CommonMark wraps them in.
 *
 * `<banner>Text</banner>` written on one line is not an HTML block (CommonMark
 * condition 7 needs the open tag alone on its line), so remark emits
 * `<p><banner>…</banner></p>`. The React component renders a <div>, and a div
 * inside a <p> is closed early by the browser's parser — the DOM then differs
 * from the server markup and hydration fails. Sticky positioning would also
 * be confined to the paragraph's box.
 *
 * Only paragraphs whose sole non-whitespace child is a listed tag are
 * unwrapped; a tag mixed into running text is left alone (author error,
 * documented as "put it on its own line"). Runs after rehypeRaw, before
 * rehypeMarkdownChildren.
 */
const BLOCK_TAGS = new Set(['banner'])

export function rehypeUnwrapBlockTags() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'p' || !parent || index === undefined) return
      let block: Element | null = null
      for (const child of node.children) {
        if (child.type === 'text') {
          if (child.value.trim() !== '') return
          continue
        }
        if (child.type === 'element' && BLOCK_TAGS.has(child.tagName) && block === null) {
          block = child
          continue
        }
        return
      }
      if (!block) return
      if (!block.position && node.position) block.position = node.position
      ;(parent.children as ElementContent[])[index] = block
    })
  }
}
