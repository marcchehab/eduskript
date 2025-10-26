import { visit } from 'unist-util-visit'

/**
 * Rehype plugin that adds data attributes to interactive elements
 * for attaching React UI controls in the preview
 */
export function rehypeInteractiveElements() {
  return function transformer(tree: unknown) {
    let codeBlockIndex = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree as Parameters<typeof visit>[0], 'element', (node: any) => {
      // Add metadata to code blocks
      if (node.tagName === 'pre') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const codeElement = node.children.find(
          (child: any) =>
            typeof child === 'object' && 'tagName' in child && child.tagName === 'code'
        )

        if (codeElement) {
          // Extract language from class (e.g., "language-javascript")
          const className = codeElement.properties?.className
          let language = ''

          if (Array.isArray(className)) {
            const langClass = className.find((cls) =>
              typeof cls === 'string' && cls.startsWith('language-')
            )
            if (langClass && typeof langClass === 'string') {
              language = langClass.replace('language-', '')
            }
          }

          // Add metadata to pre tag
          node.properties = node.properties || {}
          node.properties['data-interactive'] = 'code-block'
          node.properties['data-lang'] = language || 'text'
          node.properties['data-block-id'] = `code-block-${codeBlockIndex++}`
        }
      }

      // Future: Add metadata for images, tables, etc.
      // if (node.tagName === 'img') {
      //   node.properties['data-interactive'] = 'image'
      // }
    })
  }
}
