/**
 * Parse a ```plot fence body into a PlotSpec.
 *
 * One entry per line, order irrelevant:
 *
 *   x: -4..4            setting  (colon)
 *   f(x) = 1/3x^3 - x   curve    (equals, named)
 *   y = 2x + 1          curve    (equals, auto-named)
 *   2sin(x), blue       curve    (bare term)
 *   A = (-1, 2/3)       point    (equals, parenthesised pair)
 *   x = 3               vertical line (equals, plain number)
 *   vline x=-1, dashed  guide
 *   grid / nogrid       flag
 *
 * `x:` sets the window, `x =` draws a line — colon versus equals is the whole
 * disambiguation, and the error messages say so.
 */
import { compileExpression, PlotExpressionError } from './expression'
import type { LineStyle, PlotCurve, PlotGuide, PlotPoint, PlotSpec, PlotSpecError } from './types'

const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 400
const DEFAULT_X_RANGE: [number, number] = [-10, 10]
const MAX_CURVES = 8
const AUTO_NAMES = 'fghpqrst'.split('')

/** Colour words an author may use; resolved against the theme palette later. */
export const COLOR_WORDS = new Set([
  'red', 'blue', 'green', 'orange', 'purple', 'teal', 'pink', 'brown', 'gray', 'grey', 'black',
])

export type ParseResult = { spec: PlotSpec } | { error: PlotSpecError }

class LineError extends Error {}

export function parsePlotSpec(source: string): ParseResult {
  const curves: PlotCurve[] = []
  const points: PlotPoint[] = []
  const guides: PlotGuide[] = []
  // Previously defined curves, so `g(x) = f(x) + 2` resolves.
  const defined: Record<string, (x: number) => number> = {}

  const spec: PlotSpec = {
    curves,
    points,
    guides,
    xRange: DEFAULT_X_RANGE,
    grid: true,
    axes: true,
    legend: undefined,
    equalAspect: false,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  }

  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const text = stripComment(raw).trim()
    if (!text) continue

    try {
      parseLine(text, spec, defined)
    } catch (err) {
      if (err instanceof LineError || err instanceof PlotExpressionError) {
        return { error: { message: err.message, line: i + 1, text: raw.trim() } }
      }
      throw err
    }
  }

  return { spec }
}

// --- line dispatch ----------------------------------------------------------

function parseLine(
  text: string,
  spec: PlotSpec,
  defined: Record<string, (x: number) => number>
): void {
  const lower = text.toLowerCase()

  // Bare flags.
  if (FLAGS[lower]) {
    FLAGS[lower](spec)
    return
  }

  // `vline` / `hline` guides.
  if (/^[vh]line\b/i.test(text)) {
    spec.guides.push(parseGuide(text))
    return
  }

  // A setting is a leading identifier followed by ':' — checked before '=' so
  // `x: -4..4` never looks like an assignment.
  const setting = /^([a-z]+)\s*:\s*(.*)$/i.exec(text)
  if (setting && !text.slice(0, setting[1].length).includes('=')) {
    applySetting(setting[1].toLowerCase(), setting[2].trim(), spec)
    return
  }

  const [head, ...optionParts] = splitTopLevel(text)
  const options = parseOptions(optionParts)

  const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*=\s*(.+)$/.exec(head)
  if (assignment) {
    const [, name, argList, rhs] = assignment

    // `A = (2, 1)` — a point.
    const pair = /^\(\s*([^,]+),\s*([^)]+)\)$/.exec(rhs.trim())
    if (pair && !argList) {
      spec.points.push({
        name,
        x: constant(pair[1], `point ${name}`),
        y: constant(pair[2], `point ${name}`),
        label: options.label ?? name,
        color: options.color,
      })
      return
    }

    // `x = 3` / `y = 4` with a constant right-hand side — a guide line. `y = 2x`
    // stays a curve because the term isn't constant.
    if (!argList && (name === 'x' || name === 'y') && isConstantTerm(rhs)) {
      spec.guides.push({
        axis: name,
        value: constant(rhs, `${name} = …`),
        color: options.color,
        style: options.style,
        label: options.label,
      })
      return
    }

    addCurve(spec, defined, {
      name: argList ? name : autoName(spec),
      term: rhs.trim(),
      options,
    })
    return
  }

  // Bare term.
  addCurve(spec, defined, { name: autoName(spec), term: head, options })
}

// --- settings and flags -----------------------------------------------------

const FLAGS: Record<string, (spec: PlotSpec) => void> = {
  grid: (s) => { s.grid = true },
  nogrid: (s) => { s.grid = false },
  axes: (s) => { s.axes = true },
  noaxes: (s) => { s.axes = false },
  legend: (s) => { s.legend = true },
  nolegend: (s) => { s.legend = false },
  equal: (s) => { s.equalAspect = true },
}

function applySetting(key: string, value: string, spec: PlotSpec): void {
  switch (key) {
    case 'x':
    case 'xrange':
      spec.xRange = parseRange(value, 'x')
      return
    case 'y':
    case 'yrange':
      spec.yRange = parseRange(value, 'y')
      return
    case 'size': {
      const m = /^(\d{2,4})\s*[x×]\s*(\d{2,4})$/i.exec(value)
      if (!m) throw new LineError('size expects WIDTHxHEIGHT, for example size: 640x400')
      spec.width = clamp(Number(m[1]), 160, 1600)
      spec.height = clamp(Number(m[2]), 120, 1200)
      return
    }
    case 'aspect':
      spec.equalAspect = /^equal$/i.test(value)
      return
    case 'caption':
      spec.caption = value
      return
    case 'grid':
      spec.grid = isOn(value)
      return
    case 'axes':
      spec.axes = isOn(value)
      return
    case 'legend':
      spec.legend = isOn(value)
      return
    default:
      throw new LineError(`Unknown setting '${key}'. Known: x, y, size, aspect, caption, grid, axes, legend`)
  }
}

function isOn(value: string): boolean {
  return !/^(off|false|no)$/i.test(value.trim())
}

/** `-4..4`, `[-4, 4]` and `-4, 4` all mean the same window. */
function parseRange(value: string, axis: 'x' | 'y'): [number, number] {
  const body = value.replace(/^\[|\]$/g, '').trim()
  const parts = body.includes('..') ? body.split('..') : splitTopLevel(body)
  if (parts.length !== 2) {
    throw new LineError(
      `${axis}: expects a range like ${axis}: -5..5 — to draw a line write ${axis} = …`
    )
  }
  const min = constant(parts[0], `${axis} range`)
  const max = constant(parts[1], `${axis} range`)
  if (!(max > min)) throw new LineError(`${axis}: the upper bound must be greater than the lower one`)
  return [min, max]
}

// --- items ------------------------------------------------------------------

interface CurveOptions {
  color?: string
  label?: string
  style: LineStyle
  thick: boolean
}

function parseOptions(parts: string[]): CurveOptions {
  const out: CurveOptions = { style: 'solid', thick: false }
  for (const part of parts) {
    const token = part.trim()
    if (!token) continue
    const lower = token.toLowerCase()

    if (lower === 'dashed') { out.style = 'dashed'; continue }
    if (lower === 'dotted') { out.style = 'dotted'; continue }
    if (lower === 'thick') { out.thick = true; continue }
    if (COLOR_WORDS.has(lower) || /^#[0-9a-f]{3,8}$/i.test(token)) { out.color = lower; continue }

    const kv = /^([a-z]+)\s*=\s*(.*)$/i.exec(token)
    if (kv) {
      const key = kv[1].toLowerCase()
      const value = unquote(kv[2].trim())
      if (key === 'color') { out.color = value.toLowerCase(); continue }
      if (key === 'label') { out.label = value; continue }
    }

    throw new LineError(`Unknown option '${token}'. Known: a colour, color=…, label="…", dashed, dotted, thick`)
  }
  return out
}

function addCurve(
  spec: PlotSpec,
  defined: Record<string, (x: number) => number>,
  input: { name: string; term: string; options: CurveOptions }
): void {
  if (spec.curves.length >= MAX_CURVES) {
    throw new LineError(`Too many curves (max ${MAX_CURVES})`)
  }
  const term = input.term.trim()
  if (!term) throw new LineError('Missing expression')

  const fn = compileExpression(term, defined)
  defined[input.name] = fn

  spec.curves.push({
    name: input.name,
    term,
    fn,
    color: input.options.color,
    label: input.options.label,
    style: input.options.style,
    thick: input.options.thick,
  })
}

/**
 * `vline x=-1, dashed` — the axis word may be dropped (`vline -1`), and because
 * guides are usually written in one breath, trailing option words are accepted
 * without a comma too (`vline x=-1 dashed red`).
 */
function parseGuide(text: string): PlotGuide {
  const [rawHead, ...rest] = splitTopLevel(text)

  const words = rawHead.trim().split(/\s+/)
  while (words.length > 1 && isOptionWord(words[words.length - 1])) {
    rest.unshift(words.pop()!)
  }
  const head = words.join(' ')

  const options = parseOptions(rest)
  const m = /^([vh])line\s*(?:[xy]\s*=)?\s*(.+)$/i.exec(head)
  if (!m) throw new LineError('vline/hline expects a value, for example vline x=-1')
  return {
    axis: m[1].toLowerCase() === 'v' ? 'x' : 'y',
    value: constant(m[2], 'vline/hline'),
    color: options.color,
    style: options.style,
    label: options.label,
  }
}

// --- helpers ----------------------------------------------------------------

function isOptionWord(token: string): boolean {
  const lower = token.toLowerCase()
  return lower === 'dashed' || lower === 'dotted' || lower === 'thick' || COLOR_WORDS.has(lower)
}

function autoName(spec: PlotSpec): string {
  const used = new Set(spec.curves.map((c) => c.name))
  return AUTO_NAMES.find((n) => !used.has(n)) ?? `f${spec.curves.length + 1}`
}

/** Evaluate a constant term (`2/3`, `-pi/2`) once. */
function constant(term: string, context: string): number {
  const value = compileExpression(term.trim())(0)
  if (!Number.isFinite(value)) throw new LineError(`${context}: '${term.trim()}' is not a number`)
  return value
}

/**
 * Does the term depend on x? `\bx\b` is wrong here: `2x` has no word boundary
 * between the digit and the x, so implicit multiplication would look constant
 * and `y = 2x + 1` would turn into a horizontal line. A digit in front is fine;
 * only a letter or underscore means the x belongs to a longer name (max, exp).
 */
function isConstantTerm(term: string): boolean {
  return !/(^|[^A-Za-z_])x($|[^A-Za-z0-9_])/.test(term)
}

/** Split on commas that sit at paren depth 0 and outside quotes. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of text) {
    if (char === '"') { quoted = !quoted; current += char; continue }
    if (!quoted && (char === '(' || char === '[')) depth++
    if (!quoted && (char === ')' || char === ']')) depth--
    if (char === ',' && depth === 0 && !quoted) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter((p, idx) => idx === 0 || p.length > 0)
}

/** Drop a trailing `# comment`, but not a `#2563eb` colour. */
function stripComment(line: string): string {
  const idx = line.search(/(^|\s)#(?![0-9a-f]{3,8}\b)/i)
  return idx === -1 ? line : line.slice(0, idx)
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/s, '$1')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
