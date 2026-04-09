import { visit } from 'unist-util-visit'
import type { Element, Root, Text, ElementContent } from 'hast'

/**
 * Parse markdown links [text](url) in a string and return HAST nodes
 */
function parseMarkdownLinks(text: string): ElementContent[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: ElementContent[] = []
  let lastIndex = 0
  let match

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) } as Text)
    }
    // Add the link as an <a> element
    nodes.push({
      type: 'element',
      tagName: 'a',
      properties: {
        href: match[2],
        target: '_blank',
        rel: 'noopener noreferrer',
        className: ['text-primary', 'hover:underline', 'not-italic']
      },
      children: [{ type: 'text', value: match[1] } as Text]
    } as Element)
    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', value: text.slice(lastIndex) } as Text)
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value: text } as Text]
}

/**
 * Rehype plugin that wraps regular images (not Excalidraw) in figure elements
 * with support for alignment, wrapping, and captions
 */
export function rehypeImageWrapper() {
  return function transformer(tree: Root) {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'img' || !parent || index === null) return

      const props = node.properties || {}

      // Skip Excalidraw images (they're handled by rehypeExcalidrawDualImage)
      // Check both for data-excalidraw attribute and excalidraw-light/dark classes
      const isExcalidraw = props['dataExcalidraw'] || props['data-excalidraw']
      const className = props.className as string[] | undefined
      const hasExcalidrawClass = className?.some(c => c === 'excalidraw-light' || c === 'excalidraw-dark')
      if (isExcalidraw || hasExcalidrawClass) return

      const alt = (props.alt as string) || ''
      const caption = alt // Only show caption if alt text is provided

      // Get alignment and wrap attributes
      const dataAlign = props['dataAlign'] || props['data-align'] || props['align'] || 'center'
      const dataWrap = props['dataWrap'] || props['data-wrap'] || props['wrap']
      const style = props.style as string | undefined

      // Determine alignment classes
      const alignmentClasses = dataWrap === 'true'
        ? dataAlign === 'left'
          ? ['float-left', 'mr-4', 'mb-4']
          : dataAlign === 'right'
          ? ['float-right', 'ml-4', 'mb-4']
          : ['mx-auto'] // center doesn't make sense with wrap
        : dataAlign === 'left'
        ? ['mr-auto']
        : dataAlign === 'right'
        ? ['ml-auto']
        : ['mx-auto']

      // Create figure wrapper
      const figure: Element = {
        type: 'element',
        tagName: 'figure',
        properties: {
          className: ['my-4', ...alignmentClasses],
          ...(style ? { style } : {})
        },
        children: [
          // The image itself
          {
            type: 'element',
            tagName: 'img',
            properties: {
              ...props,
              className: ['w-full', 'h-auto', 'rounded-md']
            },
            children: []
          }
        ]
      }

      // Add caption if alt text exists (supports markdown links)
      if (caption) {
        figure.children.push({
          type: 'element',
          tagName: 'figcaption',
          properties: {
            className: ['mt-2', 'text-sm', 'text-center', 'text-muted-foreground', 'italic']
          },
          children: parseMarkdownLinks(caption)
        })
      }

      // Replace the original image node with the figure
      if ('children' in parent && Array.isArray(parent.children) && index !== null && index !== undefined) {
        parent.children[index] = figure
      }
    })
  }
}
