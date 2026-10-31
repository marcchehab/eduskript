import { visit } from 'unist-util-visit'
import { fileKind, isLocalFileRef } from '@/lib/file-refs'

/**
 * Remark plugin to mark image nodes with their original source.
 *
 * This is a PURE TRANSFORMER - it does NOT resolve file URLs.
 * File resolution happens in the component (ContentImage) using SkriptFiles.
 *
 * What it does:
 * - Adds `data-original-src` attribute with the original filename
 * - Skips excalidraw and video files (handled by their own plugins)
 * - Skips already-resolved URLs (a scheme or a leading /)
 *
 * node.url is the reference as written. remark-rehype percent-encodes it for
 * `src` (`ü` becomes `%C3%BC`), so components must look up data-original-src.
 */
export function remarkImageResolver() {
  return function transformer(tree: unknown) {
    visit(tree as Parameters<typeof visit>[0], 'image', (node: any) => {
      if (!node.url || typeof node.url !== 'string') return

      const url = node.url

      // Skip already-resolved URLs
      if (!isLocalFileRef(url)) return

      // Excalidraw and video files are handled by their own plugins
      if (fileKind(url) === 'image') {
        // Store original filename for the component to resolve
        if (!node.data) node.data = {}
        if (!node.data.hProperties) node.data.hProperties = {}
        node.data.hProperties['data-original-src'] = url
        // Keep node.url as the raw filename - component will resolve it
      }
    })
  }
}
