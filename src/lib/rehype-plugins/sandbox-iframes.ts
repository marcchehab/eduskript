import type { Element, Root } from 'hast'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'

/**
 * Forces a fixed, safe sandbox (+ lazy loading, no referrer) on every
 * `<iframe>`.
 *
 * Runs AFTER rehypeSanitize so authors can't weaken it: `sandbox` is
 * deliberately NOT in the sanitize allowlist, so any author-supplied value is
 * stripped, and we set the canonical one here.
 *
 * `allow-same-origin` applies to the EMBEDDED page's origin (e.g.
 * geotraceroute.com), not Eduskript — a cross-origin embed still can't read the
 * host page's DOM, cookies, or storage. We omit `allow-top-navigation`, so the
 * embed can't redirect the host tab. `allow-scripts` is needed for interactive
 * embeds (maps, visualisations) to run at all.
 *
 * http srcs are left as-is; on an https page the browser blocks them as mixed
 * content, which is the effective https-only guarantee.
 */
const SANDBOX = ['allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-forms']

export const rehypeSandboxIframes: Plugin<[], Root> = function () {
  return function (tree: Root) {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'iframe') return
      node.properties = node.properties || {}
      node.properties.sandbox = SANDBOX
      node.properties.loading = 'lazy'
      node.properties.referrerPolicy = 'no-referrer'
    })
  }
}
