import type { BlockContent, Blockquote, Root, Text } from 'mdast'
import type { Plugin } from 'unified'
import type { Node, Parent } from 'unist'
import { visit } from 'unist-util-visit'

// Callout type mappings and aliases
export const calloutTypes: Record<string, string> = {
  // aliases
  summary: 'abstract',
  lernziele: 'success',
  exercise: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
  // base types
  note: 'note',
  tip: 'tip',
  warning: 'warning',
  abstract: 'abstract',
  info: 'info',
  todo: 'todo',
  success: 'success',
  question: 'question',
  failure: 'failure',
  danger: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  solution: 'solution',
  discuss: 'discuss',
}

// match breaks
const find = /[\t ]*(?:\r?\n|\r)/g

export const remarkCallouts: Plugin = function () {
  return function (tree: Root) {
    visit(tree, (node: Node, index, parent: Parent) => {
      // Filter required elems
      if (node.type !== 'blockquote') return
      if (!parent || typeof index !== 'number') return

      const blockquote = node as Blockquote

      // Add breaks to text without needing spaces or escapes
      visit(node, 'text', (textNode: Text, textIndex: number, textParent: Parent) => {
        const result: Array<{ type: string; value?: string }> = []
        let start = 0

        find.lastIndex = 0
        let match = find.exec(textNode.value)

        while (match) {
          const position = match.index

          if (start !== position) {
            result.push({
              type: 'text',
              value: textNode.value.slice(start, position)
            })
          }

          result.push({ type: 'break' })
          start = position + match[0].length
          match = find.exec(textNode.value)
        }

        if (result.length > 0 && textParent && typeof textIndex === 'number') {
          if (start < textNode.value.length) {
            result.push({ type: 'text', value: textNode.value.slice(start) })
          }

          textParent.children.splice(textIndex, 1, ...result)
          return textIndex + result.length
        }
      })

      // Check for callout syntax
      if (
        blockquote.children.length <= 0 ||
        blockquote.children[0]?.type !== 'paragraph'
      )
        return

      const titleParagraph = blockquote.children[0]

      if (
        titleParagraph.children.length <= 0 ||
        titleParagraph.children[0]?.type !== 'text'
      )
        return

      const firstChild = titleParagraph.children[0]

      // Match [!type] or [!type]- or [!type]+
      // Also captures any remaining text on the same line
      const regex = /^\[!(?<keyword>.*?)\](?<foldChar>[+-]?)\s*(.*?)$/i
      const m = regex.exec(firstChild.value)

      // If no callout syntax, forget about it
      if (!m) return

      const keyword = m.groups?.keyword?.toLowerCase()
      const foldChar = m.groups?.foldChar
      const titleText = m[3] || '' // Capture the title text after [!type]

      if (!keyword) return

      // Keep only the title text (remove [!type] syntax)
      firstChild.value = titleText

      // Resolve keyword to type (handle aliases)
      const calloutType = calloutTypes[keyword] || keyword

      // Create span with title text (extract inline content from paragraph)
      const titleSpan = {
        type: 'element',
        children: titleParagraph.children, // Extract inline content (text, strong, etc.)
        data: {
          hName: 'span',
          hProperties: {
            className: 'block py-2'
          }
        }
      }

      // Create title node with callout-title class
      const titleNode = {
        type: 'element',
        children: [titleSpan],
        data: {
          hName: 'div',
          hProperties: {
            className: `callout-title ${calloutType}`
          }
        }
      }

      blockquote.children.shift()

      // Wrap remaining content in callout-content div
      const contentNode = {
        type: 'element',
        children: blockquote.children,
        data: {
          hName: 'div',
          hProperties: {
            className: 'callout-content'
          }
        }
      }

      if (blockquote.children.length > 0) {
        blockquote.children = [contentNode] as BlockContent[]
      }
      blockquote.children.unshift(titleNode as BlockContent)

      // Add classes for the callout block
      const classList = ['callout', `callout-${calloutType}`]
      if (foldChar) {
        classList.push('callout-foldable')
        if (foldChar === '-') {
          classList.push('callout-folded')
        }
      }

      blockquote.data = {
        ...blockquote.data,
        hProperties: {
          className: classList.join(' ')
        }
      }
    })
  }
}

export default remarkCallouts
