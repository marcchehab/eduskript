'use client'

import { useMemo, type ReactNode } from 'react'

interface InlineMarkdownProps {
  children: string
  className?: string
}

type Part = string | { text: string; url: string }

/**
 * Splits text into plain strings and `[text](url)` links.
 */
function parseLinks(text: string): Part[] {
  const result: Part[] = []
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) result.push(text.slice(lastIndex, match.index))
    result.push({ text: match[1], url: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) result.push(text.slice(lastIndex))
  return result
}

/**
 * Renders inline markdown for one-line fields (site slugline, page description).
 * Supports:
 * - `[text](url)` links
 * - `<nobr>…</nobr>` → non-wrapping span (links inside still work). An
 *   unclosed <nobr> runs to the end of the string. No other HTML is
 *   interpreted; it's rendered as literal text.
 *
 * Example: "Powered by [eduskript.org](https://eduskript.org)"
 * @see plainInlineText in src/lib/markdown.ts for the metadata/OG counterpart.
 */
export function InlineMarkdown({ children, className }: InlineMarkdownProps) {
  const segments = useMemo(() => {
    const out: Array<{ nowrap: boolean; parts: Part[] }> = []
    const nobrRegex = /<nobr>([\s\S]*?)(?:<\/nobr>|$)/gi
    let lastIndex = 0
    let match
    while ((match = nobrRegex.exec(children)) !== null) {
      if (match.index > lastIndex) {
        out.push({ nowrap: false, parts: parseLinks(children.slice(lastIndex, match.index)) })
      }
      out.push({ nowrap: true, parts: parseLinks(match[1]) })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < children.length) {
      out.push({ nowrap: false, parts: parseLinks(children.slice(lastIndex)) })
    }
    return out
  }, [children])

  const renderParts = (parts: Part[], keyPrefix: string): ReactNode[] =>
    parts.map((part, i) =>
      typeof part === 'string' ? (
        part
      ) : (
        <a
          key={`${keyPrefix}-${i}`}
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {part.text}
        </a>
      )
    )

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.nowrap ? (
          <span key={i} className="whitespace-nowrap">
            {renderParts(seg.parts, String(i))}
          </span>
        ) : (
          renderParts(seg.parts, String(i))
        )
      )}
    </span>
  )
}
