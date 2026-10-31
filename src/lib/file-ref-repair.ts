import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { visit } from 'unist-util-visit'
import {
  decodeFileRef,
  encodeFileRef,
  isLocalFileRef,
  normalizeFileName,
  parseFileDestination,
  UPLOADABLE_EXTENSIONS,
} from '@/lib/file-refs'

// `[label](` with one level of nested brackets, because the old file panel put
// `[Entwurf]` from the name into the label unescaped.
const LINK_OPEN = /!?\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\]\(/g

interface Candidate {
  /** Offset of the `[` or `!`. */
  start: number
  /** Offset of the first destination character. */
  from: number
  /** Offset of each `)` that could close the destination, ascending. */
  closes: number[]
  /** The close CommonMark's rule picks: `)` at parenthesis depth 0. When the
   *  parentheses never balance (`Bild (1.png)`), the first `)`. */
  shortest: number
}

function hasFileExtension(ref: string): boolean {
  return UPLOADABLE_EXTENSIONS.includes(ref.split('.').pop()!.toLowerCase())
}

/** Candidates on the line, none reaching past the next `](` or the line end. */
function findCandidates(markdown: string): Candidate[] {
  const candidates: Candidate[] = []
  for (const match of markdown.matchAll(LINK_OPEN)) {
    const from = match.index + match[0].length
    const closes: number[] = []
    let shortest: number | undefined
    let depth = 0
    for (let i = from; i < markdown.length; i++) {
      const char = markdown[i]
      if (char === '\n' || markdown.startsWith('](', i)) break
      if (char === '\\') i++
      else if (char === '(') depth++
      else if (char === ')') {
        closes.push(i)
        if (depth === 0) shortest ??= i
        else depth--
      }
    }
    if (closes.length === 0) continue
    const candidate = { start: match.index, from, closes, shortest: shortest ?? closes[0] }
    // Anything else is a plain valid destination, which needs no parse.
    if (closes.some((end) => /[\s()]/.test(parseFileDestination(markdown.slice(from, end)).ref))) {
      candidates.push(candidate)
    }
  }
  return candidates
}

/** Keep candidates the parser did not already read as code, image or link. */
function unprotected(markdown: string, candidates: Candidate[]): Candidate[] {
  if (candidates.length === 0) return candidates
  const ranges: Array<[number, number]> = []
  visit(unified().use(remarkParse).parse(markdown), (node) => {
    if (!['code', 'inlineCode', 'image', 'link', 'definition'].includes(node.type)) return
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) ranges.push([start, end])
  })
  return candidates.filter((c) => !ranges.some(([from, to]) => c.start >= from && c.start < to))
}

/**
 * Rewrite file embeds that older editors stored with a raw filename which
 * CommonMark rejects: `![](a b.png)`, `![](foto (1).png)`, `![](Bild (1.png)`,
 * `![](a *b* c.png)`, `[Label](a $x$ b.pdf)`. The destination is percent-encoded,
 * so the parser sees one image or link and never reaches the emphasis or math
 * inside it.
 *
 * Works on the source string because inline parsing has already split such a
 * name across text, emphasis and math nodes by the time a remark plugin runs.
 * This is a render-time rewrite; stored content is not changed. Each change
 * stays within its line, so the lineMap in markdown-compiler.ts still holds.
 *
 * The parser decides what is valid: anything that parses as an image, link or
 * code is left alone. It parses a second time only for pages with a candidate.
 *
 * Where a destination ends: the longest text up to a `)` that names a file in
 * `fileNames`, so a real file named "Bild 1).png" renders. Otherwise only the
 * `shortest` close counts, and it must end in a known file extension. So
 * `[a](b c) see (photo.png)` is not repaired: "b c" is no file, and the
 * parenthesised text stays text.
 *
 * Without `fileNames`, a name with a stray `)` before its extension stays
 * literal text. Both renderers pass the list (skriptFileNames), so a page renders
 * alike on the server and in the editor preview.
 */
export function repairFileRefs(markdown: string, fileNames?: Iterable<string>): string {
  if (!markdown.includes('](')) return markdown
  const candidates = findCandidates(markdown)
  if (candidates.length === 0) return markdown

  const known = new Set<string>()
  for (const name of fileNames ?? []) known.add(normalizeFileName(name))

  let out = ''
  let last = 0
  for (const { start, from, closes, shortest } of unprotected(markdown, candidates)) {
    if (start < last) continue
    const read = (end: number) => parseFileDestination(markdown.slice(from, end))
    const listed = [...closes].reverse().find((end) => {
      const { ref } = read(end)
      return known.has(normalizeFileName(decodeFileRef(ref))) || known.has(normalizeFileName(ref))
    })
    const end = listed ?? shortest
    const { ref, title } = read(end)
    if (!/[\s()]/.test(ref) || !isLocalFileRef(ref)) continue
    if (listed === undefined && !hasFileExtension(ref)) continue

    const raw = markdown.slice(from, end)
    const titleText = title === undefined ? '' : raw.slice(raw.indexOf(ref) + ref.length)
    out += `${markdown.slice(last, from)}${encodeFileRef(ref)}${titleText})`
    last = end + 1
  }
  return out + markdown.slice(last)
}

/**
 * Every reference a repairable destination could be, whichever `)` closes it.
 * For consumers that compare against stored names with matchByRefs: a phantom
 * name matches nothing, and they need no file list up front.
 */
export function possibleFileRefs(markdown: string): string[] {
  if (!markdown.includes('](')) return []
  return unprotected(markdown, findCandidates(markdown)).flatMap(({ from, closes }) =>
    closes.map((end) => parseFileDestination(markdown.slice(from, end)).ref)
  )
}
