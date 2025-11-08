import { visit } from 'unist-util-visit'
import type { Element } from 'hast'

/**
 * Rehype plugin that finds Excalidraw images (marked with data-excalidraw attribute)
 * and wraps them with a span containing both light and dark variants for CSS-based theme switching
 */
export function rehypeExcalidrawDualImage() {
  return function transformer(tree: unknown) {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'img' || !parent || index === null) return

      const props = node.properties || {}
      const dataExcalidraw = props['dataExcalidraw'] || props['data-excalidraw']
      const lightSrc = props['dataLightSrc'] || props['data-light-src'] || props.src
      const darkSrc = props['dataDarkSrc'] || props['data-dark-src']

      // Only process images that have Excalidraw data attributes
      if (!dataExcalidraw || !darkSrc) return

      const alt = (props.alt as string) || ''
      const caption = alt // Only show caption if alt text is provided

      // Extract style and attributes from the original image node
      const style = props.style as string | undefined
      const dataAlign = props['dataAlign'] || props['data-align'] || 'center'
      const dataWrap = props['dataWrap'] || props['data-wrap']

      console.log('[ExcalidrawDualImage] Processing:', {
        dataExcalidraw,
        hasStyle: !!style,
        style,
        allProps: props
      })

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

      // Create figure wrapper with both light and dark images, plus caption
      const figure: Element = {
        type: 'element',
        tagName: 'figure',
        properties: {
          className: ['excalidraw-wrapper', 'my-4', ...alignmentClasses],
          ...(style ? { style } : {})
        },
        children: [
          // Span containing both images
          {
            type: 'element',
            tagName: 'span',
            properties: {
              'data-excalidraw': dataExcalidraw
            },
            children: [
              // Light image
              {
                type: 'element',
                tagName: 'img',
                properties: {
                  src: lightSrc,
                  alt: alt,
                  className: ['excalidraw-light', 'max-w-full', 'h-auto', 'rounded-md'],
                  loading: 'lazy',
                  decoding: 'async'
                },
                children: []
              },
              // Dark image
              {
                type: 'element',
                tagName: 'img',
                properties: {
                  src: darkSrc,
                  alt: alt,
                  className: ['excalidraw-dark', 'max-w-full', 'h-auto', 'rounded-md'],
                  loading: 'lazy',
                  decoding: 'async'
                },
                children: []
              }
            ]
          }
        ]
      }

      // Add caption if it exists
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
