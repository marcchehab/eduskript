import type { Root, Image } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * Remark plugin to transform video references (![](video.mp4)) into MuxVideo components.
 *
 * This plugin ONLY transforms the markdown AST - it does NOT resolve files or fetch metadata.
 * File resolution happens in the MuxVideo component itself (via the component factory).
 *
 * Usage in markdown:
 *   ![Video title](my-video.mp4)
 *   ![autoplay loop](background-video.mp4)
 *   ![](my-video.mp4 "thumbnail.jpg")   ← poster from a skript file (or absolute URL)
 *
 * The standard markdown image-title field doubles as the poster filename. Authors
 * can also write the HTML directly: <muxvideo src="x.mp4" poster="thumb.jpg" />.
 */

// Minimal HTML attribute-value escape — guards against an alt or title that
// contains a quote breaking out of the attribute.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function remarkMuxVideo() {
  return function transformer(tree: Root) {
    visit(tree, 'image', (node: Image) => {
      const url = node.url

      // Skip already-resolved URLs (http, https, or absolute paths)
      if (!url || url.startsWith('http') || url.startsWith('https') || url.startsWith('/')) {
        return
      }

      // Only handle video files
      if (!url.endsWith('.mp4') && !url.endsWith('.mov')) {
        return
      }

      // Convert to raw HTML so it gets parsed by rehype-raw
      // The MuxVideo component will handle file resolution and metadata fetching
      const alt = node.alt || ''
      const poster = node.title || ''

      const attrs = [
        `src="${escapeAttr(url)}"`,
        `alt="${escapeAttr(alt)}"`,
      ]
      if (poster) {
        attrs.push(`poster="${escapeAttr(poster)}"`)
      }

      const mutableNode = node as unknown as Record<string, unknown>
      mutableNode.type = 'html'
      mutableNode.value = `<muxvideo ${attrs.join(' ')}></muxvideo>`
      delete mutableNode.url
      delete mutableNode.alt
      delete mutableNode.title
      delete mutableNode.children
    })

    return tree
  }
}
