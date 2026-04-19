/**
 * Auto-allow `<plugin>` config attributes.
 *
 * `<plugin>` elements render in a sandboxed iframe via PluginContainer; their
 * attributes are forwarded to the iframe over postMessage and never end up as
 * real DOM attributes. The previous design hand-maintained an allowlist of
 * every config name across every plugin in the sanitize schema — anything
 * not in the list (e.g. `font`, `mod`) was silently stripped.
 *
 * This plugin walks the tree once before sanitize and adds whatever attribute
 * names it finds on `<plugin>` elements to the schema's plugin allowlist.
 * The sanitizer then lets them through naturally — no encoding round-trip,
 * no per-element rewriting. It mutates the supplied schema in place; callers
 * must pass a per-request clone so concurrent renders don't pollute each
 * other's allowlists.
 *
 * Security note: this widens the allowlist for `<plugin>` only. Attribute
 * *values* still go through rehype-sanitize's normal rules (URL protocols,
 * etc.), and the iframe sandbox is the actual security boundary for the
 * plugin's behavior.
 */
import { visit } from 'unist-util-visit'
import type { Root } from 'hast'

type AttrEntry = string | [string, ...unknown[]]

interface MutableSchema {
  attributes?: Record<string, AttrEntry[]>
}

export function rehypeAllowPluginAttrs(schema: MutableSchema) {
  return (tree: Root) => {
    const existing = schema.attributes?.plugin ?? []
    const allowed = new Set<string>(existing.map((a) => (Array.isArray(a) ? a[0] : a)))
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'plugin' || !node.properties) return
      for (const attr of Object.keys(node.properties)) allowed.add(attr)
    })
    if (!schema.attributes) schema.attributes = {}
    schema.attributes.plugin = [...allowed]
  }
}
