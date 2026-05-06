import type { Root, Element } from 'hast'
import { visit } from 'unist-util-visit'
import { parseStableLink } from '@/lib/page-stable-link'

// Rewrite `/p/{id}` hrefs to their canonical public URLs at compile time, so
// public pages ship with real slug-based hrefs instead of relying on the
// /p/[id] redirect route on every click. The map is built up-front from a
// single batched DB query (see resolveStableLinks); links not in the map
// (unpublished/missing/unknown) pass through unchanged and resolve via the
// redirect route at click time.
export function rehypeStablePageLinks(resolved: Map<string, { url: string }>) {
  return (tree: Root) => {
    if (resolved.size === 0) return
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties?.href
      if (typeof href !== 'string') return
      const id = parseStableLink(href)
      if (!id) return
      const hit = resolved.get(id)
      if (!hit) return
      node.properties = { ...node.properties, href: hit.url }
    })
  }
}
