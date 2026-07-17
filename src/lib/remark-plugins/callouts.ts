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
  idea: 'idea',
  code: 'code',
}

// match breaks
const find = /[\t ]*(?:\r?\n|\r)/g

export const remarkCallouts: Plugin<[], Root> = function () {
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

      // Resolve keyword to type (handle aliases)
      const calloutType = calloutTypes[keyword] || keyword

      // Split content: title is only on the first line, rest goes to body
      // Look for a break node in the title paragraph - content after it should be in body
      const titleChildren: typeof titleParagraph.children = []
      const bodyChildren: typeof titleParagraph.children = []
      let foundBreak = false

      // First, update the text node to remove [!type] syntax
      firstChild.value = titleText

      for (const child of titleParagraph.children) {
        if (child.type === 'break') {
          foundBreak = true
          continue // Skip the break itself
        }
        if (!foundBreak) {
          titleChildren.push(child)
        } else {
          bodyChildren.push(child)
        }
      }

      // Create span with title text only
      const titleSpan = {
        type: 'element',
        children: titleChildren,
        data: {
          hName: 'span',
          hProperties: {
            className: ['block', 'py-2']
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
            className: ['callout-title', calloutType]
          }
        }
      }

      // Remove the title paragraph from blockquote
      blockquote.children.shift()

      // If there was content after a break in the title paragraph, prepend it as a new paragraph
      if (bodyChildren.length > 0) {
        const bodyParagraph = {
          type: 'paragraph',
          children: bodyChildren
        }
        blockquote.children.unshift(bodyParagraph as BlockContent)
      }

      // Wrap remaining content in callout-content div
      const contentNode = {
        type: 'element',
        children: blockquote.children,
        data: {
          hName: 'div',
          hProperties: {
            className: ['callout-content']
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
          className: classList
        }
      }
    })
  }
}

export default remarkCallouts
