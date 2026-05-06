import type { Root, Element } from 'hast'
import { visit } from 'unist-util-visit'

// Two rules, applied in this order per <a>:
//
//   1. If `title` is exactly `_blank`, treat it as an opt-in marker:
//      set target="_blank" + rel="noopener noreferrer" and DELETE the title
//      so it doesn't render as a tooltip. Lets authors force-popout an
//      otherwise-internal link with `[text](url "_blank")`.
//
//   2. Otherwise, if href starts with `http://` or `https://`, the link is
//      external — set target/rel automatically. Any existing title is left
//      alone and renders as a normal tooltip.
//
// Same-origin absolute URLs (e.g. `https://eduskript.org/foo`) are caught by
// rule 2 as a side effect; that's acceptable for a content site, since
// authors writing the full URL almost always mean it as external context.
//
// Idempotent: skips links that already have a target.
export function rehypeExternalLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const props = node.properties ?? {}
      if (props.target) return

      if (props.title === '_blank') {
        delete props.title
        props.target = '_blank'
        props.rel = 'noopener noreferrer'
        node.properties = props
        return
      }

      const href = typeof props.href === 'string' ? props.href : ''
      if (href.startsWith('http://') || href.startsWith('https://')) {
        props.target = '_blank'
        props.rel = 'noopener noreferrer'
        node.properties = props
      }
    })
  }
}
