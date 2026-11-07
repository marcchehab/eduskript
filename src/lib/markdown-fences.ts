const FENCE_RE = /^[ \t]*(```|~~~)/

/** Char ranges (incl. the fence lines themselves) covered by ``` / ~~~ fenced blocks. */
export function fencedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let inFence = false
  let fenceStart = 0
  let offset = 0
  for (const line of content.split('\n')) {
    if (FENCE_RE.test(line)) {
      if (!inFence) {
        inFence = true
        fenceStart = offset
      } else {
        inFence = false
        ranges.push([fenceStart, offset + line.length])
      }
    }
    offset += line.length + 1 // +1 for the '\n' split away
  }
  return ranges
}

/**
 * Replace the first match of `pattern` that is NOT inside a fenced code
 * block. Gizmo-driven rewrites (resize/align on an image, molecule, spacer,
 * video) key on a tag's own attributes (src/smiles/id) — a first-match-in-
 * whole-string replace happily rewrites a literal example shown inside a ```
 * fence instead of the live tag below it when both share the same value.
 *
 * `onLine` (1-based, the element's data-source-line-start) only accepts a
 * match that BEGINS on that line, so the second of two identical images or
 * videos is the one rewritten when its gizmo is used, and a pattern that does
 * not fit the element there (e.g. the tag pattern on a `![](…)` shorthand)
 * returns null instead of hitting a twin elsewhere — callers chain patterns
 * with `??`. Without `onLine` the first match wins. Returns null when no
 * match exists (caller treats that as a no-op). O(n) in content length.
 */
export function replaceOutsideFences(content: string, pattern: RegExp, replacement: string | ((match: string) => string), onLine?: number): string | null {
  let from = 0
  let to = Infinity
  if (onLine) {
    const range = lineRange(content, onLine)
    if (!range) return null
    ;[from, to] = range
  }
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  const fences = fencedRanges(content)
  for (const match of content.matchAll(globalPattern)) {
    const start = match.index
    if (start < from) continue
    if (start >= to) return null
    if (fences.some(([fs, fe]) => start >= fs && start < fe)) continue
    const text = typeof replacement === 'function' ? replacement(match[0]) : replacement
    return content.slice(0, start) + text + content.slice(start + match[0].length)
  }
  return null
}

/** [start, end) char offsets of a 1-based line (end = offset after its '\n'), or null past the end. */
function lineRange(content: string, line: number): [number, number] | null {
  let offset = 0
  for (let l = 1; l < line; l++) {
    const next = content.indexOf('\n', offset)
    if (next === -1) return null
    offset = next + 1
  }
  const end = content.indexOf('\n', offset)
  return [offset, end === -1 ? content.length : end + 1]
}
