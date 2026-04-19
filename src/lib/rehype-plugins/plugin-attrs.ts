/**
 * <plugin> attribute pass-through.
 *
 * `<plugin>` elements render in a sandboxed iframe and their attributes are
 * just config keys forwarded over postMessage — they're never written to the
 * DOM as real HTML attributes. The sanitizer otherwise can't tell a plugin's
 * `font="12"` from a malicious `onclick="…"`, so without help it would either
 * (a) need a hand-maintained allowlist of every config name across every
 * plugin (the prior approach — it dropped `font` and any other unlisted name
 * silently), or (b) allow arbitrary attributes everywhere (XSS).
 *
 * Workaround: stash all custom attrs into a single allowed `data-plugin-attrs`
 * JSON blob before sanitize, restore them after. The sanitizer only has to
 * trust one attribute name; plugin authors can use any config keys they want.
 */
import { visit } from 'unist-util-visit'
import type { Properties, Root } from 'hast'

// Attributes the React PluginContainer reads as named props (not as plugin
// config). These stay as real attributes so the sanitizer can apply its
// normal URL/value rules to `src` etc.
const INTRINSIC_ATTRS = new Set(['src', 'id', 'height', 'width'])

const STASH_ATTR = 'data-plugin-attrs'

export function rehypePluginAttrsStash() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'plugin') return
      const props = node.properties || {}
      const stash: Record<string, unknown> = {}
      const kept: Properties = {}
      for (const [k, v] of Object.entries(props)) {
        // className / style are already allowed for `*` and shouldn't be stashed
        if (INTRINSIC_ATTRS.has(k.toLowerCase()) || k === 'className' || k === 'style') {
          kept[k] = v
        } else {
          stash[k] = v
        }
      }
      if (Object.keys(stash).length > 0) {
        kept[STASH_ATTR] = JSON.stringify(stash)
      }
      node.properties = kept
    })
  }
}

export function rehypePluginAttrsRestore() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'plugin') return
      const props = node.properties
      if (!props) return
      const raw = props[STASH_ATTR]
      if (typeof raw !== 'string') return
      try {
        const stash = JSON.parse(raw) as Properties
        delete props[STASH_ATTR]
        for (const [k, v] of Object.entries(stash)) {
          props[k] = v
        }
      } catch {
        // Malformed stash — drop it silently rather than leaking the JSON
        // string into the DOM as an attribute.
        delete props[STASH_ATTR]
      }
    })
  }
}
