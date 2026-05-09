import { visit, SKIP } from 'unist-util-visit'
import type { Root, Element } from 'hast'

/**
 * Rehype plugin to add data-section-id attributes to elements for annotation alignment.
 *
 * Tracks:
 * - h1, h2, h3 headings (using their slug as ID)
 * - pre (code blocks)
 * - code-editor (interactive editors) - dynamic height due to console output
 * - plugin (iframe plugins) - dynamic height due to iframe auto-resize
 * - blockquote.callout (callouts) - dynamic height when collapsed/expanded
 * - figure (images)
 * - table (tables)
 * - flex (side-by-side layout container) - subsumes its descendants
 *
 * `<flex>` is treated as a single section: it gets its own section ID and the
 * walker skips its subtree, so headings/callouts/etc. that sit side-by-side
 * inside a flex don't each spawn their own section. Without this, two siblings
 * laid out horizontally would produce two vertically-stacked sections in the
 * annotation model and strokes would anchor to the wrong column.
 *
 * Dynamic-height elements also get data-dynamic-height="true" so the client
 * can track both top and bottom positions, AND get a 0-height sibling
 * `<div data-section-id="${id}-end">` inserted right after them. The sibling
 * is what the per-section annotation portal anchors to: strokes drawn near
 * the bottom of a dynamic-height element get sectionId `${id}-end` (assigned
 * by simple-canvas.tsx using the headingPositions list), and the sibling
 * gives those strokes a real DOM anchor that follows the element's bottom
 * edge as it grows/shrinks.
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
    flex: 0,
  }

  return (tree: Root) => {
    // Collect end-sentinel insertions during visit; apply after the walk so we
    // don't perturb traversal indices. Each entry: { parent, index, sectionId }.
    const inserts: Array<{ parent: Element | Root; index: number; sectionId: string }> = []

    visit(tree, 'element', (node: Element, index, parent) => {
      node.properties = node.properties || {}

      // Flex container: claims one section ID for the whole subtree and
      // SKIPs descendants so siblings inside don't each become a section.
      // Marked dynamic-height because callouts inside can fold/unfurl.
      if (node.tagName === 'flex') {
        const sectionId = `flex-${counters.flex++}`
        node.properties['data-section-id'] = sectionId
        node.properties['data-dynamic-height'] = 'true'
        if (parent && typeof index === 'number') {
          inserts.push({ parent: parent as Element | Root, index, sectionId })
        }
        return SKIP
      }

      // H1-H3 headings (use slug-based ID)
      if (['h1', 'h2', 'h3'].includes(node.tagName)) {
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
        if (parent && typeof index === 'number') {
          inserts.push({ parent: parent as Element | Root, index, sectionId })
        }
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
        if (parent && typeof index === 'number') {
          inserts.push({ parent: parent as Element | Root, index, sectionId })
        }
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
          if (parent && typeof index === 'number') {
            inserts.push({ parent: parent as Element | Root, index, sectionId })
          }
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

    // Apply end-sentinel insertions in reverse order so earlier indices stay valid.
    inserts.sort((a, b) => b.index - a.index)
    for (const { parent, index, sectionId } of inserts) {
      const sentinel: Element = {
        type: 'element',
        tagName: 'div',
        properties: {
          'data-section-id': `${sectionId}-end`,
          'data-section-end': 'true',
          'aria-hidden': 'true',
          style: 'height:0;pointer-events:none',
        },
        children: [],
      }
      parent.children.splice(index + 1, 0, sentinel)
    }
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
