import { visit } from 'unist-util-visit'
import type { Root, Code } from 'mdast'

/**
 * Shiki-compatible line annotations for read-only code blocks.
 *
 * Trailing markers inside a comment are stripped from the code and carried to
 * the rendered <code> element as 1-based line lists, which CodeBlock turns into
 * CodeMirror line decorations:
 *
 *   ship = Turtle()   # [!code ++]        → dataAdd
 *   turtle.done()     # [!code --]        → dataDel
 *   x = 42            # [!code highlight] → dataHighlight
 *   y = f(x)          # [!code focus]     → dataFocus (dims every other line)
 *
 * A `:N` suffix extends the marker over N lines starting at that line:
 *   def move():       # [!code ++:3]
 *
 * Ranges can also be given in the info string, avoiding comments in the code:
 *   ```python {2,5-7} add={3-4} del={9} focus={1}
 *
 * Colour tints (no +/− sign, no diff meaning) colour-code lines, e.g. to match
 * a coloured result table: `red={2} green={3} blue={4}` or `# [!code red]`.
 * Colours: red, green, blue, yellow, purple. One tint per line; a later
 * mark on the same line wins. Carried as dataTint="2:red,3:green".
 *
 * The comment token before the marker is optional and stripped along with it
 * (`#`, `//`, `--`, `;`, `%`, `/* ... *\/`, `<!-- ... -->`). A line whose only
 * content was the marker becomes an empty line — that is how Shiki authors mark
 * an added blank line.
 *
 * Runs after remarkCodeEditor (interactive editors keep their text verbatim)
 * and mirrors remarkCodeCopy's approach: remark-rehype drops `meta`, so
 * everything the renderer needs has to travel as hProperties.
 */

type MarkKind = 'add' | 'del' | 'highlight' | 'focus'

export const TINT_COLORS = ['red', 'green', 'blue', 'yellow', 'purple'] as const
type TintColor = (typeof TINT_COLORS)[number]
const TINT_ALT = TINT_COLORS.join('|')

const KIND_BY_TOKEN: Record<string, MarkKind> = {
  '++': 'add',
  '--': 'del',
  'highlight': 'highlight',
  'hl': 'highlight',
  'focus': 'focus',
}

// Optional comment opener + [!code <kind>[:n]] + optional comment closer, anchored
// at the end of the line. The `--` alternative covers both the SQL/Lua comment
// token and nothing at all (the `--` marker itself is matched by the group).
const MARKER_RE = new RegExp(
  `[ \\t]*(?:(?:\\/\\/|#|--|;|%|\\/\\*|<!--)[ \\t]*)?\\[!code[ \\t]+(\\+\\+|--|highlight|hl|focus|${TINT_ALT})(?::(\\d+))?\\][ \\t]*(?:-->|\\*\\/)?[ \\t]*$`,
)

const META_RANGE_RE = new RegExp(`(?:\\b(add|del|focus|highlight|${TINT_ALT})=)?\\{([\\d,\\s-]+)\\}`, 'g')

function isTint(token: string): token is TintColor {
  return (TINT_COLORS as readonly string[]).includes(token)
}

/** Parse `1,3-5` into 1-based line numbers. Silently skips malformed parts. */
function parseRanges(spec: string): number[] {
  const lines: number[] = []
  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from >= 1 && to >= from) for (let n = from; n <= to; n++) lines.push(n)
      continue
    }
    const single = Number(trimmed)
    if (Number.isInteger(single) && single >= 1) lines.push(single)
  }
  return lines
}

export function remarkCodeAnnotations() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code) => {
      const marks: Record<MarkKind, Set<number>> = {
        add: new Set(),
        del: new Set(),
        highlight: new Set(),
        focus: new Set(),
      }
      const tints = new Map<number, TintColor>()
      const mark = (token: string, line: number) => {
        if (isTint(token)) tints.set(line, token)
        else marks[KIND_BY_TOKEN[token] ?? (token as MarkKind)].add(line)
      }

      // Info-string ranges: a bare {…} means highlight.
      const meta = node.meta ?? ''
      for (const match of meta.matchAll(META_RANGE_RE)) {
        const token = match[1] ?? 'highlight'
        for (const line of parseRanges(match[2])) mark(token, line)
      }

      // Inline markers.
      const lines = node.value.split('\n')
      let stripped = false
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(MARKER_RE)
        if (!match) continue
        stripped = true
        lines[i] = lines[i].slice(0, match.index).trimEnd()
        const token = match[1].toLowerCase()
        const span = match[2] ? Math.max(1, Number(match[2])) : 1
        for (let n = 0; n < span && i + n < lines.length; n++) mark(token, i + n + 1)
      }

      const hProperties: Record<string, string> = {}
      if (marks.add.size) hProperties.dataAdd = [...marks.add].sort((a, b) => a - b).join(',')
      if (marks.del.size) hProperties.dataDel = [...marks.del].sort((a, b) => a - b).join(',')
      if (marks.highlight.size) hProperties.dataHighlight = [...marks.highlight].sort((a, b) => a - b).join(',')
      if (marks.focus.size) hProperties.dataFocus = [...marks.focus].sort((a, b) => a - b).join(',')
      if (tints.size) {
        hProperties.dataTint = [...tints].sort(([a], [b]) => a - b).map(([line, c]) => `${line}:${c}`).join(',')
      }

      if (Object.keys(hProperties).length === 0) return
      if (stripped) node.value = lines.join('\n')

      const data = (node.data ??= {})
      data.hProperties = { ...(data.hProperties ?? {}), ...hProperties }
    })
  }
}
