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
 * Remark plugin to convert ```mermaid code blocks into <plugin> elements.
 * The diagram definition is passed as inner text content (read via config.content in the plugin SDK).
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

      // Encode content to survive HTML serialization
      const encoded = definition
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

      parent.children[i] = {
        type: 'html',
        value: `<plugin src="eduadmin/mermaid-diagram">${encoded}</plugin>`,
      } as Node
    }
  }
}
