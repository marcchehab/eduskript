import { visit } from 'unist-util-visit'
import type { Root, Code } from 'mdast'

/**
 * Carries a `copy` directive from a fenced code block's info string to the
 * rendered <code> element as `dataCopy`, so the read-only CodeBlock can show or
 * hide its copy button. remark-rehype drops `meta` otherwise.
 *
 *   ```python copy=false   → dataCopy="false"  (hide the copy button)
 *   ```python no-copy      → dataCopy="false"
 *   ```python copy         → dataCopy="true"   (force-show, e.g. on an exam)
 *   ```python copy=true    → dataCopy="true"
 *
 * No directive → no attribute → the renderer's default applies (shown normally,
 * hidden on exam pages).
 *
 * Also carries `filename="window.py"` (quotes optional without spaces) as
 * `dataFilename`, shown as a title bar above the block. Runs after remarkCodeEditor, so ```lang editor blocks
 * (already transformed to <code-editor>) are never matched here.
 */
export function remarkCodeCopy() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      const meta = node.meta ?? ''
      let copy: string | undefined
      if (/\bno-?copy\b/i.test(meta)) {
        copy = 'false'
      } else {
        const m = meta.match(/\bcopy(?:=(true|false))?\b/i)
        if (m) copy = m[1] ? m[1].toLowerCase() : 'true'
      }
      const filename = meta.match(/\bfilename=(?:"([^"]+)"|'([^']+)'|(\S+))/i)
      const name = filename?.[1] ?? filename?.[2] ?? filename?.[3]
      if (copy === undefined && !name) return
      const data = (node.data ??= {})
      data.hProperties = {
        ...(data.hProperties ?? {}),
        ...(copy !== undefined ? { dataCopy: copy } : {}),
        ...(name ? { dataFilename: name } : {}),
      }
    })
  }
}
