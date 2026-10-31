import type { Root, Image } from 'mdast'
import { visit } from 'unist-util-visit'
import { escapeHtmlAttr, fileKind, isLocalFileRef } from '@/lib/file-refs'

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

export function remarkMuxVideo() {
  return function transformer(tree: Root) {
    visit(tree, 'image', (node: Image) => {
      const url = node.url

      // Skip already-resolved URLs; only handle video files
      if (!url || !isLocalFileRef(url) || fileKind(url) !== 'video') return

      // Convert to raw HTML so it gets parsed by rehype-raw
      // The MuxVideo component will handle file resolution and metadata fetching
      const alt = node.alt || ''
      const poster = node.title || ''

      const attrs = [
        `src="${escapeHtmlAttr(url)}"`,
        `alt="${escapeHtmlAttr(alt)}"`,
      ]
      if (poster) {
        attrs.push(`poster="${escapeHtmlAttr(poster)}"`)
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
