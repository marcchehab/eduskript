import { visit } from 'unist-util-visit'
import type { Root, Html, Paragraph, Text } from 'mdast'

/**
 * Remark plugin to transform <Youtube> / <youtube> components into custom elements.
 *
 * Transforms:
 * ```
 * <youtube id="dQw4w9WgXcQ" />
 * <Youtube id="dQw4w9WgXcQ" startTime={120} />
 * <youtube playlist="PLxyz..." />
 * ```
 *
 * Into <youtube-embed> custom elements rendered by the React Youtube component.
 *
 * Tag matching is case-insensitive but requires whitespace or `/` directly after
 * the tag name, so the already-emitted <youtube-embed> output is left alone.
 */

// Self-closing: <youtube ... /> — the trailing whitespace requirement keeps
// <youtube-embed/> (no space, hyphen) from matching.
const SELF_CLOSING_RE = /<youtube\s+([^>]*?)\/>/gi

// Opening tag: <youtube ...> — same whitespace guard.
const OPENING_RE = /<youtube\s+([^>]*?)>/gi

const CLOSING_RE = /<\/youtube>/gi

function transformInline(html: string): string {
  return html
    .replace(SELF_CLOSING_RE, (_, attrs) => parseYoutubeAttrs(attrs))
    .replace(OPENING_RE, (_, attrs) => parseYoutubeAttrs(attrs))
    .replace(CLOSING_RE, '')
}

export function remarkYoutube() {
  return function transformer(tree: Root) {
    // First pass: remove import statements for Youtube (legacy MDX-style content)
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || index === undefined) return

      const paragraph = node as Paragraph
      if (paragraph.children.length === 1 && paragraph.children[0].type === 'text') {
        const text = (paragraph.children[0] as Text).value
        if (text.trim().startsWith('import ') && /youtube/i.test(text)) {
          parent.children.splice(index, 1)
          return index
        }
      }
    })

    // Process HTML nodes
    visit(tree, 'html', (node: Html) => {
      if (/<youtube[\s/]/i.test(node.value) || /<\/youtube>/i.test(node.value)) {
        node.value = transformInline(node.value)
      }
    })

    // Also check paragraphs that might contain the JSX-like syntax as text
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || index === undefined) return

      const paragraph = node as Paragraph

      let fullText = ''
      for (const child of paragraph.children) {
        if (child.type === 'text') {
          fullText += (child as Text).value
        }
      }

      if (!/<youtube[\s/]/i.test(fullText) && !/<\/youtube>/i.test(fullText)) return

      const transformed = transformInline(fullText)
      if (transformed !== fullText) {
        const htmlNode: Html = {
          type: 'html',
          value: transformed,
        }
        parent.children[index] = htmlNode
      }
    })
  }
}

function parseYoutubeAttrs(attrs: string): string {
  const idMatch = attrs.match(/\bid=["']([^"']+)["']/)
  const id = idMatch ? idMatch[1] : ''

  const playlistMatch = attrs.match(/\bplaylist=["']([^"']+)["']/)
  const playlist = playlistMatch ? playlistMatch[1] : ''

  // startTime accepts {123}, "123", or '123'
  const startTimeMatch = attrs.match(/\bstartTime=\{?["']?(\d+)["']?\}?/)
  const startTime = startTimeMatch ? startTimeMatch[1] : ''

  const captionMatch = attrs.match(/\bcaption=["']([^"']*)["']/)
  const caption = captionMatch ? captionMatch[1] : ''

  let element = '<youtube-embed'
  if (id) element += ` data-id="${id}"`
  if (playlist) element += ` data-playlist="${playlist}"`
  if (startTime) element += ` data-start-time="${startTime}"`
  if (caption) element += ` data-caption="${caption}"`
  element += '></youtube-embed>'

  return element
}
