import type { TextHighlight } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('text-highlights:render')

const LEGACY_COLORS = new Set(['yellow', 'red', 'green', 'blue', 'purple'])

/**
 * Resolve a highlight's stored colour to a translucent CSS background.
 * Legacy named colours keep their existing globals.css variable (identical
 * look). Arbitrary colours (from a highlighter pen) render at reduced alpha so
 * text stays readable — like a real highlighter.
 */
export function highlightBackground(color: string): string {
  if (LEGACY_COLORS.has(color)) return `var(--text-highlight-${color})`
  // Theme ink (currentColor): translucent foreground, flips with the theme.
  if (color === 'currentColor') return 'color-mix(in srgb, currentColor 35%, transparent)'
  // hsl(h s l) → hsl(h s l / .35)
  if (/^hsl\(/i.test(color) && !color.includes('/')) {
    return color.replace(/\)\s*$/, ' / 0.35)')
  }
  // #rrggbb / #rgb → rgb(r g b / .35)
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgb(${r} ${g} ${b} / 0.35)`
  }
  return color
}

/**
 * Wrap a DOM Range in <mark> elements with highlight styling.
 * Handles ranges spanning multiple text nodes by wrapping each segment.
 */
export function applyHighlightMark(range: Range, highlight: TextHighlight): void {
  const background = highlightBackground(highlight.color)
  const highlightId = highlight.id

  // If range is within a single text node, wrap directly
  if (
    range.startContainer === range.endContainer &&
    range.startContainer.nodeType === Node.TEXT_NODE
  ) {
    const mark = createMark(background, highlightId)
    range.surroundContents(mark)
    log('apply single-node', { id: highlightId, text: range.toString() })
    return
  }

  // Multi-node range: collect all text nodes within the range, then wrap each
  const textNodes = getTextNodesInRange(range)
  let wrapped = 0
  let skipped = 0
  let fellBack = 0

  for (const { node, start, end } of textNodes) {
    const text = node.nodeValue ?? ''
    if (start >= end || start >= text.length) {
      skipped++
      continue
    }

    // Skip whitespace-only segments (e.g. newlines between <p> tags) —
    // wrapping these creates visible empty highlight blocks between paragraphs.
    const segment = text.slice(start, end)
    if (!segment.trim()) {
      skipped++
      continue
    }

    const mark = createMark(background, highlightId)
    const wrappedRange = document.createRange()
    wrappedRange.setStart(node, start)
    wrappedRange.setEnd(node, Math.min(end, text.length))

    try {
      wrappedRange.surroundContents(mark)
      wrapped++
    } catch (err) {
      // surroundContents can fail if the range partially selects a non-text node.
      // Fall back to extracting and appending.
      log('surroundContents threw, using extract/insert fallback', {
        id: highlightId,
        segment,
        parentTag: node.parentElement?.tagName,
        error: (err as Error)?.message,
      })
      const fragment = wrappedRange.extractContents()
      mark.appendChild(fragment)
      wrappedRange.insertNode(mark)
      fellBack++
    }
  }

  log('apply multi-node', {
    id: highlightId,
    segments: textNodes.length,
    wrapped,
    skipped,
    fellBack,
  })
}

function createMark(background: string, highlightId: string): HTMLElement {
  const mark = document.createElement('mark')
  mark.className = 'text-highlight'
  mark.style.backgroundColor = background
  mark.dataset.highlightId = highlightId
  return mark
}

interface TextNodeSegment {
  node: Text
  start: number
  end: number
}

/**
 * Collect all Text nodes within a Range, with their in-node start/end offsets.
 */
function getTextNodesInRange(range: Range): TextNodeSegment[] {
  const segments: TextNodeSegment[] = []
  const ancestor = range.commonAncestorContainer

  const root =
    ancestor.nodeType === Node.ELEMENT_NODE
      ? (ancestor as Element)
      : ancestor.parentElement

  if (!root) return segments

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let inRange = false

  while (node) {
    const textNode = node as Text
    const len = textNode.nodeValue?.length ?? 0

    if (textNode === range.startContainer) {
      inRange = true
      const start = range.startOffset
      const end =
        textNode === range.endContainer ? range.endOffset : len
      if (start < end) segments.push({ node: textNode, start, end })
    } else if (textNode === range.endContainer) {
      if (range.endOffset > 0) {
        segments.push({ node: textNode, start: 0, end: range.endOffset })
      }
      break
    } else if (inRange && len > 0) {
      segments.push({ node: textNode, start: 0, end: len })
    }

    node = walker.nextNode()
  }

  return segments
}

/**
 * Remove all <mark> elements for a specific highlight, replacing them
 * with their text content and normalizing the parent.
 */
export function removeHighlightMark(id: string): void {
  const marks = document.querySelectorAll(`mark[data-highlight-id="${CSS.escape(id)}"]`)
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    // Replace mark with its children
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark)
    }
    parent.removeChild(mark)
    parent.normalize()
  })
}

/**
 * Remove all text highlight marks within a container.
 */
export function clearAllHighlightMarks(container: Element): void {
  const marks = container.querySelectorAll('mark.text-highlight')
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark)
    }
    parent.removeChild(mark)
    parent.normalize()
  })
}
