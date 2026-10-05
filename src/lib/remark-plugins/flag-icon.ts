import { visit } from 'unist-util-visit'
import type { Root, Text, Parent } from 'mdast'

// Files in /public/flags/. de-ch/en-gb match the signup page's language picker
// (src/app/(app)/auth/signup/page.tsx); ch is the plain (square) Swiss flag.
// Rendered by FlagIconComponent in src/lib/markdown-components.tsx.
const FLAG_CODES = ['ch', 'de-ch', 'en-gb']
const FLAG_PATTERN = new RegExp(`:flag-(${FLAG_CODES.join('|')}):`, 'g')

/**
 * `:flag-ch:` / `:flag-en-gb:` / `:flag-de-ch:` — inline flag icon usable anywhere in
 * markdown text, e.g. a heading like "User Manual :flag-en-gb:". Splices a
 * matched text node into text/html siblings, mirroring how
 * remarkYoutubeImage rewrites a node into a custom raw-HTML element.
 */
export function remarkFlagIcon() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parent | undefined) => {
      if (!parent || index === undefined) return
      FLAG_PATTERN.lastIndex = 0
      if (!FLAG_PATTERN.test(node.value)) return

      const parts: Array<Text | { type: 'html'; value: string }> = []
      let lastIndex = 0
      let match: RegExpExecArray | null
      FLAG_PATTERN.lastIndex = 0
      while ((match = FLAG_PATTERN.exec(node.value))) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: node.value.slice(lastIndex, match.index) })
        }
        parts.push({ type: 'html', value: `<flag-icon data-code="${match[1]}"></flag-icon>` })
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(lastIndex) })
      }

      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}
