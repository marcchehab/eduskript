import { visit } from 'unist-util-visit'
import type { Node } from 'unist'

interface ImageNode extends Node {
  type: 'image'
  url: string
  alt?: string
  title?: string
  data?: {
    hProperties?: Record<string, unknown>
  }
}

interface TextNode extends Node {
  type: 'text'
  value: string
}

/**
 * Remark plugin that parses image attributes like {width=50%}
 * and applies them as inline styles
 */
export function remarkImageAttributes() {
  return function transformer(tree: Node) {
    visit(tree, 'paragraph', (node: any) => {
      if (!node.children) return

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]

        // Look for image followed by text with attributes
        if (child.type === 'image' && i + 1 < node.children.length) {
          const nextChild = node.children[i + 1] as TextNode

          if (nextChild.type === 'text') {
            // Match {width=X%;align=left|center|right} pattern
            const attrMatch = nextChild.value.match(/^\{([^}]+)\}/)

            if (attrMatch) {
              const attrsString = attrMatch[1]
              const attrs = attrsString.split(';').reduce((acc, attr) => {
                const [key, value] = attr.split('=').map(s => s.trim())
                if (key && value) acc[key] = value
                return acc
              }, {} as Record<string, string>)

              // Apply attributes
              child.data = child.data || {}
              child.data.hProperties = child.data.hProperties || {}

              // Width
              if (attrs.width) {
                const widthPercent = attrs.width.replace('%', '')
                child.data.hProperties.style = `width: ${widthPercent}%; height: auto;`
              }

              // Alignment
              if (attrs.align) {
                child.data.hProperties['data-align'] = attrs.align
              }

              // Wrap
              if (attrs.wrap) {
                child.data.hProperties['data-wrap'] = attrs.wrap
              }

              // Remove the attribute text from the markdown
              nextChild.value = nextChild.value.replace(/^\{[^}]+\}/, '').trim()

              // If the text node is now empty, remove it
              if (!nextChild.value) {
                node.children.splice(i + 1, 1)
              }
            }
          }
        }
      }
    })
  }
}
