import { visit } from 'unist-util-visit'

/**
 * Rehype plugin to add source line position data to elements
 * Used for editor preview to highlight the paragraph corresponding to cursor position
 *
 * Adds data-source-line-start and data-source-line-end attributes based on
 * the markdown source position information preserved through the AST.
 *
 * `lineMap` (optional) translates PROCESSED line numbers (AST positions reflect
 * the string AFTER compileMarkdown's preprocessing — expand-self-closing /
 * question-spacing / container-delimiting add or remove blank lines) back to
 * the editor's ORIGINAL line numbers, so the editor↔preview cursor sync lines
 * up. `lineMap[processedLine - 1] = originalLine`. Without it, positions pass
 * through unchanged.
 */
export function rehypeSourceLine(lineMap?: number[]) {
  const toOriginal = (line: number) =>
    lineMap && lineMap[line - 1] != null ? lineMap[line - 1] : line

  return function transformer(tree: any) {
    // Block-level HTML elements to track source lines for
    const blockElements = new Set([
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'pre', 'blockquote', 'ul', 'ol', 'li',
      'table', 'div', 'section', 'article', 'figure', 'span',
      'code-editor', // Interactive code editor blocks
      'excalidraw-image', // Excalidraw drawings
      'spacer', // <spacer> writing area
      'muxvideo', // Video embeds
      'image', // Custom Image component
      'img', // Native images
      // Custom container components — so clicking inside them in the preview
      // highlights/maps to their source lines (their inner content may be
      // re-parsed and position-stripped, so the container itself anchors it).
      // Only tags whose React component forwards data-source-line-* to its DOM
      // root are listed; clicks inside e.g. an <answer> bubble up to <question>.
      'question',
      'flex', 'flex-item',
      'tabs-container',
      'fullwidth',
    ])

    // Process HTML elements
    visit(tree, 'element', (node: any) => {
      if (!blockElements.has(node.tagName)) return

      // Try to get position from node itself
      let startLine = node.position?.start?.line
      let endLine = node.position?.end?.line

      // If this element doesn't have position, try to get it from first child
      if ((!startLine || !endLine) && node.children?.length > 0) {
        const firstChild = node.children[0]
        if (firstChild?.position?.start?.line && firstChild?.position?.end?.line) {
          startLine = firstChild.position.start.line
          endLine = firstChild.position.end.line
        }
      }

      // Skip if we still don't have position info
      if (!startLine || !endLine) return

      // Add source line attributes, mapped back to original editor lines.
      node.properties = node.properties || {}
      node.properties['data-source-line-start'] = toOriginal(startLine)
      node.properties['data-source-line-end'] = toOriginal(endLine)
    })
  }
}
