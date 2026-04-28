import type { Root, Image } from 'mdast'
import { visit } from 'unist-util-visit'
import { parseYoutubeUrl } from '@/lib/youtube-url'

/**
 * Remark plugin to transform YouTube URLs in image syntax into <youtube-embed> elements.
 *
 * Usage in markdown:
 *   ![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)
 *   ![Caption shown beneath the video](https://youtu.be/dQw4w9WgXcQ?t=120)
 *   ![](https://www.youtube.com/playlist?list=PLxyz)
 *
 * URL recognition lives in src/lib/youtube-url.ts so the paste-helper shares it.
 */

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function remarkYoutubeImage() {
  return function transformer(tree: Root) {
    visit(tree, 'image', (node: Image) => {
      const ref = parseYoutubeUrl(node.url || '')
      if (!ref) return

      const caption = node.alt || ''
      const attrs: string[] = []
      if (ref.id) attrs.push(`data-id="${escapeAttr(ref.id)}"`)
      if (ref.playlist) attrs.push(`data-playlist="${escapeAttr(ref.playlist)}"`)
      if (ref.startTime) attrs.push(`data-start-time="${ref.startTime}"`)
      if (caption) attrs.push(`data-caption="${escapeAttr(caption)}"`)

      const mutableNode = node as unknown as Record<string, unknown>
      mutableNode.type = 'html'
      mutableNode.value = `<youtube-embed ${attrs.join(' ')}></youtube-embed>`
      delete mutableNode.url
      delete mutableNode.alt
      delete mutableNode.title
      delete mutableNode.children
    })

    return tree
  }
}
