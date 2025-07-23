import { visit } from 'unist-util-visit'

/**
 * Rehype plugin to optimize images by adding loading and decoding attributes
 */
export function rehypeImageOptimizer() {
  return function transformer(tree: unknown) {
    // Visit all img elements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree as Parameters<typeof visit>[0], 'element', (node: any) => {
      if (node.tagName !== 'img') return

      // Add optimization attributes
      node.properties = node.properties || {}
      
      // Add lazy loading
      if (!node.properties.loading) {
        node.properties.loading = 'lazy'
      }
      
      // Add decode hint for better performance
      if (!node.properties.decoding) {
        node.properties.decoding = 'async'
      }
    })
  }
} 