import type { Root } from 'mdast'
import type { Plugin } from 'unified'
import type { Node } from 'unist'
import { visit } from 'unist-util-visit'

/**
 * Maps Pandoc-style fenced div directives to alignment <div> elements:
 *
 *   :::center
 *   ## Centered heading
 *   :::
 *
 * becomes `<div class="es-align-center">…</div>`. Names other than
 * left/center/right are intentionally left untouched so other directive use
 * cases (added later) aren't pre-empted by this plugin.
 *
 * Pairs with `remark-directive` (which parses the syntax into the
 * `containerDirective` node type) — both must be registered.
 */

type DirectiveNode = Node & {
  type: 'containerDirective'
  name: string
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

const ALIGN_NAMES = new Set(['left', 'center', 'right'])

export const remarkAlign: Plugin<[], Root> = function () {
  return function (tree: Root) {
    visit(tree, (node: Node) => {
      if (node.type !== 'containerDirective') return
      const directive = node as DirectiveNode
      if (!ALIGN_NAMES.has(directive.name)) return

      directive.data = {
        ...(directive.data || {}),
        hName: 'div',
        hProperties: { className: ['es-align-' + directive.name] },
      }
    })
  }
}

export default remarkAlign
