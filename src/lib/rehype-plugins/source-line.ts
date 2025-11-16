import { visit } from 'unist-util-visit'

/**
 * Rehype plugin to add source line position data to elements
 * Used for editor preview to highlight the paragraph corresponding to cursor position
 *
 * Adds data-source-line-start and data-source-line-end attributes based on
 * the markdown source position information preserved through the AST
 */
export function rehypeSourceLine() {
  return function transformer(tree: any) {
    visit(tree, 'element', (node: any) => {
      // Only add to block-level elements
      const blockElements = new Set([
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'pre', 'blockquote', 'ul', 'ol', 'li',
        'table', 'div', 'section', 'article',
        'code-editor' // Interactive code editor blocks
      ])

      if (!blockElements.has(node.tagName)) return

      // Try to get position from node itself
      let startLine = node.position?.start?.line
      let endLine = node.position?.end?.line

      // If this element doesn't have position, try to get it from first child
      // This handles cases where wrapper elements (like sections) don't have position
      if ((!startLine || !endLine) && node.children?.length > 0) {
        const firstChild = node.children[0]
        if (firstChild?.position?.start?.line && firstChild?.position?.end?.line) {
          startLine = firstChild.position.start.line
          endLine = firstChild.position.end.line
        }
      }

      // Skip if we still don't have position info
      if (!startLine || !endLine) return

      // Add source line attributes
      node.properties = node.properties || {}
      node.properties['data-source-line-start'] = startLine
      node.properties['data-source-line-end'] = endLine
    })
  }
}
