import { visit } from 'unist-util-visit'

/**
 * Remark plugin that lifts `{attr=val;attr2}` syntax following a markdown
 * image into hProperties on the image node.
 *
 * The page-editor's "Invert" toolbar tool emits this syntax (see
 * `insertInvert` in src/components/dashboard/codemirror-editor.tsx), so this
 * plugin is what bridges the toolbar's markdown to the `invert` prop that
 * ContentImage reads via the `<img>` handler in markdown-components.tsx.
 *
 * Examples:
 *   ![](dna.png){invert}              → <img invert="dark">
 *   ![](dna.png){invert=light}        → <img invert="light">
 *   ![](dna.png){invert;saturate=70}  → <img invert="dark" saturate="70">
 *
 * Bare `invert` resolves to `invert=dark` because the toolbar's default
 * dark-mode invert emits no value. Other bare flags become `key="true"`.
 *
 * Unsupported attributes pass through to hProperties; the sanitize schema
 * (sanitizeSchema in markdown-compiler.ts) silently drops anything not on
 * the img allowlist.
 */
const ATTR_BLOCK_RE = /^\{([^}]*)\}/

export function remarkImageAttrs() {
  return function transformer(tree: unknown) {
    visit(tree as Parameters<typeof visit>[0], (node: any, index: number | undefined, parent: any) => {
      if (node.type !== 'image' || !parent || index === undefined) return

      const next = parent.children[index + 1]
      if (!next || next.type !== 'text' || typeof next.value !== 'string') return

      const match = next.value.match(ATTR_BLOCK_RE)
      if (!match) return

      const props: Record<string, string> = {}
      for (const part of match[1].split(';').map((s: string) => s.trim()).filter(Boolean)) {
        const eq = part.indexOf('=')
        if (eq === -1) {
          if (part === 'invert') props.invert = 'dark'
          else props[part] = 'true'
        } else {
          const key = part.slice(0, eq).trim()
          const value = part.slice(eq + 1).trim()
          if (key) props[key] = value
        }
      }

      if (!node.data) node.data = {}
      if (!node.data.hProperties) node.data.hProperties = {}
      Object.assign(node.data.hProperties, props)

      // Truncate the consumed `{…}` from the following text node. Leaving an
      // empty text node is harmless; splicing during visit is not.
      next.value = next.value.slice(match[0].length)
    })
  }
}
