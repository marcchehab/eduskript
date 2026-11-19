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
 * Walks every container, so a diagram inside a callout, a list item, a
 * <solution> or a <flex-item> is transformed too (it used to handle top-level
 * fences only, which left those as plain code blocks).
 *
 * Example markdown:
 * ```mermaid
 * graph LR
 *   A --> B --> C
 * ```
 */
export function remarkMermaid() {
  return (tree: Node) => {
    walk(tree)
  }
}

function walk(node: Node): void {
  const parent = node as ParentNode
  if (!Array.isArray(parent.children)) return

  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i] as CodeNode
    if (child.type === 'code' && child.lang === 'mermaid') {
      const definition = (child.value || '').trim()
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
      continue
    }
    walk(child)
  }
}
