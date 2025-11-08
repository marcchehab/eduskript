import { visit } from 'unist-util-visit'
import type { Element } from 'hast'

/**
 * Rehype plugin that wraps regular images (not Excalidraw) in figure elements
 * with support for alignment, wrapping, and captions
 */
export function rehypeImageWrapper() {
  return function transformer(tree: unknown) {
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
      const dataAlign = props['dataAlign'] || props['data-align'] || 'center'
      const dataWrap = props['dataWrap'] || props['data-wrap']
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

      // Add caption if alt text exists
      if (caption) {
        figure.children.push({
          type: 'element',
          tagName: 'figcaption',
          properties: {
            className: ['mt-2', 'text-sm', 'text-center', 'text-muted-foreground', 'italic']
          },
          children: [
            {
              type: 'text',
              value: caption
            }
          ]
        })
      }

      // Replace the original image node with the figure
      if ('children' in parent && Array.isArray(parent.children)) {
        parent.children[index] = figure
      }
    })
  }
}
