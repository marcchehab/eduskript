/**
 * Typeset a function term as SVG `<tspan>`s: italic variables, raised
 * exponents, proper operator glyphs.
 *
 * This is deliberately NOT KaTeX. The plot is delivered as a `data:` URL inside
 * an `<img>`, and browsers render neither HTML `foreignObject` nor MathML in
 * that context — the only text an img-SVG can show is SVG text. So the term is
 * approximated with the three things that carry most of the "this is maths"
 * signal: slanted variables, real superscripts and − / · instead of - / *.
 *
 * Deliberately out of scope: stacked fractions, roots with an overbar, nested
 * exponents beyond one level.
 */

/** Names that stay upright, like in a textbook. */
const UPRIGHT = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'exp', 'ln', 'log', 'log2', 'log10', 'lg', 'sqrt', 'abs', 'sign',
  'floor', 'ceil', 'round', 'min', 'max', 'mod',
])

const GLYPHS: Record<string, string> = {
  '*': '·',
  '-': '−',
  'pi': 'π',
  'tau': 'τ',
  '<=': '≤',
  '>=': '≥',
  '!=': '≠',
}

interface Piece {
  text: string
  italic?: boolean
  /** Raised, smaller — an exponent. */
  sup?: boolean
}

/** Split a term into typographic pieces. One superscript level, no recursion. */
export function typesetPieces(term: string): Piece[] {
  const pieces: Piece[] = []
  let i = 0

  const push = (text: string, extra: Partial<Piece> = {}) => {
    const last = pieces[pieces.length - 1]
    if (last && !!last.italic === !!extra.italic && !!last.sup === !!extra.sup) {
      last.text += text
      return
    }
    pieces.push({ text, ...extra })
  }

  while (i < term.length) {
    const rest = term.slice(i)

    // Two-character operators first.
    const two = rest.slice(0, 2)
    if (GLYPHS[two]) {
      push(GLYPHS[two])
      i += 2
      continue
    }

    const char = term[i]

    // Exponent: everything up to the end of the exponent expression is raised.
    if (char === '^') {
      const exponent = readExponent(rest.slice(1))
      if (exponent) {
        for (const piece of typesetPieces(exponent)) {
          push(piece.text, { italic: piece.italic, sup: true })
        }
        i += 1 + exponent.length
        continue
      }
      push('^')
      i += 1
      continue
    }

    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0]
    if (name) {
      if (GLYPHS[name]) push(GLYPHS[name])
      else if (UPRIGHT.has(name)) push(name)
      else if (name.length === 1) push(name, { italic: true })
      // Multi-letter unknown names (a user function like `fx`) stay upright —
      // italicising them would read as a product of variables.
      else push(name)
      i += name.length
      continue
    }

    if (GLYPHS[char]) {
      push(GLYPHS[char])
      i += 1
      continue
    }

    push(char)
    i += 1
  }

  return pieces
}

/**
 * The exponent that follows `^`: a parenthesised group, or the run of
 * characters that binds to the caret (`x^2`, `x^-1`, `e^2x` → `2x`).
 */
function readExponent(rest: string): string {
  if (rest.startsWith('(')) {
    let depth = 0
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '(') depth++
      if (rest[i] === ')') {
        depth--
        if (depth === 0) return rest.slice(0, i + 1)
      }
    }
    return rest
  }
  return /^-?[A-Za-z0-9_.]+/.exec(rest)?.[0] ?? ''
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render the pieces as SVG tspans. `dy` shifts are paired so the baseline
 * returns after an exponent — SVG has no automatic baseline stack.
 */
export function typesetTspans(term: string, fontSize: number): string {
  const pieces = typesetPieces(term)
  const out: string[] = []
  let raised = false

  for (const piece of pieces) {
    const attrs: string[] = []
    if (piece.italic) attrs.push('font-style="italic"')
    if (piece.sup && !raised) {
      attrs.push(`dy="${(-fontSize * 0.4).toFixed(1)}"`, `font-size="${(fontSize * 0.75).toFixed(1)}"`)
      raised = true
    } else if (!piece.sup && raised) {
      attrs.push(`dy="${(fontSize * 0.4).toFixed(1)}"`)
      raised = false
    } else if (piece.sup) {
      attrs.push(`font-size="${(fontSize * 0.75).toFixed(1)}"`)
    }
    out.push(`<tspan${attrs.length ? ' ' + attrs.join(' ') : ''}>${escapeText(piece.text)}</tspan>`)
  }

  // Close a trailing superscript so following text (none today, but the label
  // may grow) sits on the baseline again.
  if (raised) out.push(`<tspan dy="${(fontSize * 0.4).toFixed(1)}"></tspan>`)

  return out.join('')
}
