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
 * Convert ```plot fences into <function-plot> elements. The fence body rides in
 * `data-spec`; the SVG is generated in the component (see
 * src/components/markdown/function-plot.tsx and src/lib/plot/).
 *
 * A fence keeps its body verbatim, so terms may contain `<`, `*`, `^` and quotes
 * without any escaping dance — the reason plots are a fence and not a tag with
 * attributes.
 *
 * Unlike remarkMermaid this walks every container, so a plot inside a callout,
 * a list item or a <flex-item> is transformed too.
 *
 * Example:
 * ```plot
 * x: -4..4
 * f(x) = 1/3x^3 - x
 * ```
 */
export function remarkPlot() {
  return (tree: Node) => {
    walk(tree)
  }
}

function walk(node: Node): void {
  const parent = node as ParentNode
  if (!Array.isArray(parent.children)) return

  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i] as CodeNode
    if (child.type === 'code' && child.lang === 'plot') {
      const source = (child.value || '').trim()
      if (!source) continue
      parent.children[i] = {
        type: 'html',
        value: `<function-plot data-spec="${escapeAttribute(source)}"></function-plot>`,
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
}
