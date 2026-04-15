import type { Node } from 'unist'

interface CodeNode extends Node {
  type: 'code'
  lang?: string
  meta?: string
  value?: string
}

interface ParentNode extends Node {
  children: Node[]
}

/**
 * Remark plugin to convert ```mermaid code blocks into <mermaid-diagram>
 * custom elements. Rendering happens in the React markdown tree via the
 * MermaidDiagram component (see src/components/markdown/mermaid-diagram.tsx).
 *
 * Example markdown:
 * ```mermaid
 * graph LR
 *   A --> B --> C
 * ```
 */
export function remarkMermaid() {
  return (tree: Node) => {
    const parent = tree as ParentNode
    if (!parent.children) return

    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i] as CodeNode
      if (node.type !== 'code' || node.lang !== 'mermaid') continue

      const definition = (node.value || '').trim()
      if (!definition) continue

      // Encode definition for safe inclusion in the data attribute
      const encoded = definition
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

      parent.children[i] = {
        type: 'html',
        value: `<mermaid-diagram data-definition="${encoded}"></mermaid-diagram>`,
      } as Node
    }
  }
}
