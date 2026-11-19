import type { Node } from 'unist'

interface CodeNode extends Node {
  type: 'code'
  lang?: string
  value?: string
}

interface ParentNode extends Node {
  children: Node[]
}

/**
 * Convert ```tikz fences into <tikz-figure> elements. The fence body rides in
 * `data-source`; TeX runs on the server (src/lib/tikz/render.server.ts) and the
 * result is shown as an <img> (src/components/markdown/tikz-figure.tsx).
 *
 * Like remarkPlot this walks every container, so a diagram inside a callout, a
 * list item or a <flex-item> is transformed too.
 */
export function remarkTikz() {
  return (tree: Node) => {
    walk(tree)
  }
}

function walk(node: Node): void {
  const parent = node as ParentNode
  if (!Array.isArray(parent.children)) return

  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i] as CodeNode
    if (child.type === 'code' && child.lang === 'tikz') {
      const source = (child.value || '').trim()
      if (!source) continue
      parent.children[i] = {
        type: 'html',
        value: `<tikz-figure data-source="${escapeAttribute(source)}"></tikz-figure>`,
      } as Node
      continue
    }
    walk(child)
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // A raw newline in an attribute survives HTML parsing, but keep it explicit.
    .replace(/\n/g, '&#10;')
}
