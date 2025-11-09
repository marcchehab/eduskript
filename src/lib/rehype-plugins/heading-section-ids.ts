import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'

/**
 * Rehype plugin to add data-section-id and data-heading-text attributes to h1-h2 headings
 * for the annotation system
 */
export function rehypeHeadingSectionIds() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      // Only process h1-h2 headings
      if (!['h1', 'h2'].includes(node.tagName)) {
        return
      }

      // Get the heading ID (should be set by rehypeSlug)
      const headingId = node.properties?.id as string | undefined

      if (!headingId) {
        return
      }

      // Extract text content from heading
      const headingText = extractText(node)

      // Generate section ID
      const sectionId = `${node.tagName}-${headingId}`

      // Add data attributes
      node.properties = node.properties || {}
      node.properties['data-section-id'] = sectionId
      node.properties['data-heading-text'] = headingText
    })
  }
}

/**
 * Extract text content from an element node
 */
function extractText(node: Element): string {
  let text = ''

  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'text') {
        text += child.value
      } else if (child.type === 'element') {
        text += extractText(child as Element)
      }
    }
  }

  return text
}
