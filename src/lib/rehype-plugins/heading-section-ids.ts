import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'

/**
 * Rehype plugin to add data-section-id attributes to elements for annotation alignment.
 *
 * Tracks:
 * - h1, h2 headings (using their slug as ID)
 * - pre (code blocks)
 * - code-editor (interactive editors) - dynamic height due to console output
 * - plugin (iframe plugins) - dynamic height due to iframe auto-resize
 * - blockquote.callout (callouts) - dynamic height when collapsed/expanded
 * - figure (images)
 * - table (tables)
 *
 * Dynamic-height elements also get data-dynamic-height="true" so the client
 * can track both top and bottom positions.
 */
export function rehypeHeadingSectionIds() {
  // Counters for generating sequential IDs
  const counters: Record<string, number> = {
    pre: 0,
    'code-editor': 0,
    plugin: 0,
    callout: 0,
    figure: 0,
    table: 0,
  }

  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      node.properties = node.properties || {}

      // H1-H2 headings (use slug-based ID)
      if (['h1', 'h2'].includes(node.tagName)) {
        const headingId = node.properties?.id as string | undefined
        if (!headingId) return

        const headingText = extractText(node)
        const sectionId = `${node.tagName}-${headingId}`

        node.properties['data-section-id'] = sectionId
        node.properties['data-heading-text'] = headingText
        return
      }

      // Code blocks (pre elements, but not inside code-editor)
      if (node.tagName === 'pre') {
        const sectionId = `pre-${counters.pre++}`
        node.properties['data-section-id'] = sectionId
        return
      }

      // Interactive code editors (custom element)
      if (node.tagName === 'code-editor') {
        const sectionId = `editor-${counters['code-editor']++}`
        node.properties['data-section-id'] = sectionId
        node.properties['data-dynamic-height'] = 'true' // Console output can change height
        return
      }

      // Plugin iframes (custom element) - dynamic height due to iframe auto-resize
      // Uses src attribute for stable IDs (sequential counters break when plugins are added/removed)
      if (node.tagName === 'plugin') {
        const src = node.properties?.src as string | undefined
        const sectionId = src
          ? `plugin-${src.replace(/[^a-zA-Z0-9-]/g, '-')}`
          : `plugin-${counters.plugin++}`
        node.properties['data-section-id'] = sectionId
        node.properties['data-dynamic-height'] = 'true'
        return
      }

      // Callouts (blockquote with callout class)
      if (node.tagName === 'blockquote') {
        const classes = node.properties?.className
        const classArray = Array.isArray(classes) ? classes : [classes]
        if (classArray.some(c => String(c).includes('callout'))) {
          const sectionId = `callout-${counters.callout++}`
          node.properties['data-section-id'] = sectionId
          node.properties['data-dynamic-height'] = 'true' // Collapsible
          return
        }
      }

      // Figures (images wrapped in figure tags)
      if (node.tagName === 'figure') {
        const sectionId = `figure-${counters.figure++}`
        node.properties['data-section-id'] = sectionId
        return
      }

      // Tables
      if (node.tagName === 'table') {
        const sectionId = `table-${counters.table++}`
        node.properties['data-section-id'] = sectionId
        return
      }
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
