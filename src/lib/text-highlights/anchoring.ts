import type { TextHighlight } from './types'
import { createLogger } from '@/lib/logger'

const log = createLogger('text-highlights:anchor')

/** Tags whose text content should be skipped when building the virtual text map */
const SKIP_TAGS = new Set(['PRE', 'CODE', 'CODE-EDITOR'])

interface TextMapping {
  node: Text
  /** Start offset of this node's text in the virtual string */
  start: number
}

export interface TextMap {
  text: string
  mapping: TextMapping[]
}

/**
 * Build a virtual text string from all visible TEXT_NODEs under `root`,
 * skipping code blocks and editors. Returns the concatenated text plus
 * a mapping from virtual-string positions back to DOM Text nodes.
 */
export function buildTextMap(root: Element): TextMap {
  const mapping: TextMapping[] = []
  let text = ''

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement
      while (parent && parent !== root) {
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        parent = parent.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  while (current) {
    const textNode = current as Text
    const value = textNode.nodeValue ?? ''
    if (value.length > 0) {
      mapping.push({ node: textNode, start: text.length })
      text += value
    }
    current = walker.nextNode()
  }

  return { text, mapping }
}

/**
 * Given a virtual-string offset range [start, end), find the corresponding
 * DOM Range spanning across the actual Text nodes.
 */
function virtualRangeToDomRange(
  start: number,
  end: number,
  mapping: TextMapping[],
): Range | null {
  if (mapping.length === 0) return null

  const range = document.createRange()
  let foundStart = false
  let foundEnd = false

  for (let i = 0; i < mapping.length; i++) {
    const m = mapping[i]
    const nodeLen = m.node.nodeValue?.length ?? 0
    const nodeEnd = m.start + nodeLen

    // Set range start
    if (!foundStart && start < nodeEnd) {
      range.setStart(m.node, start - m.start)
      foundStart = true
    }

    // Set range end
    if (!foundEnd && end <= nodeEnd) {
      range.setEnd(m.node, end - m.start)
      foundEnd = true
      break
    }
  }

  if (!foundStart || !foundEnd) return null
  return range
}

/** Normalize whitespace for fuzzy matching: collapse runs of whitespace to single space */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Score how well a candidate match's surrounding text matches the stored prefix/suffix.
 * Higher is better. Uses longest common substring length.
 */
function contextScore(
  virtualText: string,
  matchStart: number,
  matchEnd: number,
  prefix: string,
  suffix: string,
): number {
  const beforeText = virtualText.slice(Math.max(0, matchStart - 60), matchStart)
  const afterText = virtualText.slice(matchEnd, matchEnd + 60)

  return lcsLength(beforeText, prefix) + lcsLength(afterText, suffix)
}

/** Longest common substring length — O(n*m) but inputs are small (~60 chars) */
function lcsLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0
  let max = 0
  // Use 1D rolling array to save memory
  const prev = new Uint16Array(b.length + 1)
  const curr = new Uint16Array(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
        if (curr[j] > max) max = curr[j]
      } else {
        curr[j] = 0
      }
    }
    prev.set(curr)
    curr.fill(0)
  }
  return max
}

/** Find all occurrences of `needle` in `haystack`, returning start indices */
function findAllOccurrences(haystack: string, needle: string): number[] {
  const results: number[] = []
  let pos = 0
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos)
    if (idx === -1) break
    results.push(idx)
    pos = idx + 1
  }
  return results
}

/**
 * Anchor a highlight to the DOM, returning a Range or null if unresolved.
 *
 * Strategy:
 * 1. Search within the highlight's section (data-section-id)
 * 2. If section missing, search entire article
 * 3. Exact match first, then normalized-whitespace match
 * 4. Disambiguate multiple matches with prefix/suffix scoring
 */
export function anchorHighlight(
  highlight: TextHighlight,
  articleRoot: Element,
): Range | null {
  log('anchor start', {
    id: highlight.id,
    text: highlight.text,
    textLen: highlight.text.length,
    sectionId: highlight.sectionId,
    prefix: highlight.prefix,
    suffix: highlight.suffix,
  })

  // Try section-scoped search first
  const searchRoots: Element[] = []

  if (highlight.sectionId) {
    const section = articleRoot.querySelector(
      `[data-section-id="${CSS.escape(highlight.sectionId)}"]`,
    )
    if (section) {
      searchRoots.push(section)
    } else {
      log('section not found, will fall back to article', { sectionId: highlight.sectionId })
    }
  }

  // Fallback to whole article
  searchRoots.push(articleRoot)

  for (const root of searchRoots) {
    const textMap = buildTextMap(root)
    const rootKind = root === articleRoot ? 'article' : 'section'

    // Exact match
    const exactMatches = findAllOccurrences(textMap.text, highlight.text)
    log('search root', {
      rootKind,
      rootTag: root.tagName,
      mapTextLen: textMap.text.length,
      exactMatches: exactMatches.length,
    })

    if (exactMatches.length === 1) {
      log('matched exact (unique)', { id: highlight.id, idx: exactMatches[0], rootKind })
      return virtualRangeToDomRange(
        exactMatches[0],
        exactMatches[0] + highlight.text.length,
        textMap.mapping,
      )
    }
    if (exactMatches.length > 1) {
      // Disambiguate with context
      let bestIdx = exactMatches[0]
      let bestScore = -1
      const scored: Array<{ idx: number; score: number }> = []
      for (const idx of exactMatches) {
        const score = contextScore(
          textMap.text,
          idx,
          idx + highlight.text.length,
          highlight.prefix,
          highlight.suffix,
        )
        scored.push({ idx, score })
        if (score > bestScore) {
          bestScore = score
          bestIdx = idx
        }
      }
      log('matched exact (disambiguated)', {
        id: highlight.id,
        rootKind,
        chosen: bestIdx,
        chosenScore: bestScore,
        scored,
        prefixLen: highlight.prefix.length,
        suffixLen: highlight.suffix.length,
      })
      if (bestScore === 0) {
        log.warn('disambiguation had no signal — first match picked by default', {
          id: highlight.id,
          text: highlight.text,
          candidates: exactMatches,
        })
      }
      return virtualRangeToDomRange(
        bestIdx,
        bestIdx + highlight.text.length,
        textMap.mapping,
      )
    }

    // Normalized whitespace match
    const normalizedNeedle = normalizeWhitespace(highlight.text)
    const normalizedHaystack = normalizeWhitespace(textMap.text)
    const normalizedMatches = findAllOccurrences(normalizedHaystack, normalizedNeedle)
    if (normalizedMatches.length > 0) {
      // Map normalized position back to original text position (approximate)
      // Find the original text that corresponds to the normalized match
      const origIdx = textMap.text.indexOf(highlight.text.trim())
      if (origIdx !== -1) {
        log('matched normalized', { id: highlight.id, rootKind, origIdx })
        return virtualRangeToDomRange(
          origIdx,
          origIdx + highlight.text.trim().length,
          textMap.mapping,
        )
      } else {
        log('normalized match found but original text not located', {
          id: highlight.id,
          normalizedMatches: normalizedMatches.length,
          trimmedText: highlight.text.trim(),
        })
      }
    }
  }

  log.warn('anchor failed', {
    id: highlight.id,
    text: highlight.text,
    sectionId: highlight.sectionId,
    prefix: highlight.prefix,
    suffix: highlight.suffix,
  })
  return null
}

const CONTEXT_LENGTH = 30

/**
 * Extract prefix and suffix context around a Selection Range.
 * Builds a text map from the article root and locates the selection within it.
 */
export function extractContext(
  range: Range,
  articleRoot: Element,
): { prefix: string; suffix: string } {
  const textMap = buildTextMap(articleRoot)
  const selectedText = range.toString()

  // Map the Range's actual DOM start position to the virtual-text offset
  // so we extract context around the *correct* occurrence, not the first one.
  let virtualStart = -1
  for (const m of textMap.mapping) {
    if (m.node === range.startContainer) {
      virtualStart = m.start + range.startOffset
      break
    }
  }
  if (virtualStart === -1) {
    // startContainer is an Element (selection at a child boundary), not in mapping.
    // Without a virtualStart we return empty context — anchoring may then fail to
    // disambiguate identical text occurrences.
    log.warn('extractContext: range startContainer not in text map — empty prefix/suffix', {
      startContainerNodeType: range.startContainer.nodeType,
      startContainerName: (range.startContainer as Element).tagName ?? '#text',
      startOffset: range.startOffset,
      selectedText,
    })
    return { prefix: '', suffix: '' }
  }

  const prefix = textMap.text.slice(Math.max(0, virtualStart - CONTEXT_LENGTH), virtualStart)
  const suffix = textMap.text.slice(
    virtualStart + selectedText.length,
    virtualStart + selectedText.length + CONTEXT_LENGTH,
  )

  log('extractContext', { prefixLen: prefix.length, suffixLen: suffix.length, prefix, suffix })
  return { prefix, suffix }
}

/**
 * Walk up from a node to find the nearest ancestor with `data-section-id`.
 */
export function findSectionId(node: Node): string {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement

  while (el) {
    const sectionId = el.getAttribute('data-section-id')
    if (sectionId) return sectionId
    el = el.parentElement
  }
  return ''
}
