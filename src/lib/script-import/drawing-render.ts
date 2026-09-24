/**
 * Word drawings (shapes) → PNG, before pandoc runs.
 *
 * Teachers draw vector sketches, circuits, flow charts and labelled diagrams
 * with Word's shape tools (DrawingML groups, drawing canvases, loose shapes
 * anchored to a paragraph). pandoc drops all of that. This module renders
 * each such drawing to a PNG, adds it to the .docx as a normal picture and
 * replaces the drawing with it, so the rest of the pipeline treats it like
 * any other image.
 *
 * Covered (what the 2026-09 corpus of 30 teacher files uses): groups
 * (wpg, nested), canvases (wpc), shapes (wps) with transform/rotation/flip,
 * preset geometries (rect, roundRect, ellipse, line/connectors incl. bent,
 * triangle, diamond, parallelogram, block arrows, star, arc, common flow-chart
 * shapes), custom geometry paths, solid/theme colours (+ lumMod/lumOff/shade/
 * tint), dashes, arrow heads, pictures inside drawings (incl. WMF/EMF via
 * wmf-render.ts), text boxes with styled runs, legacy formula objects and a
 * subset of Word formulas (OMML: runs, sub/superscripts, fractions, accents
 * incl. vector arrows, delimiters, roots, n-ary, bars).
 *
 * Not covered: gradients (first stop only), shadows/3D/effects, text on
 * shapes' own geometry (only text boxes), WordArt, charts, SmartArt, VML-only
 * drawings from Word ≤ 2003 (no mc:AlternateContent), and exact text metrics
 * (KaTeX fonts stand in for Calibri/Cambria, so text runs may be slightly
 * wider or narrower than in Word). Unknown preset shapes are drawn as their
 * bounding rectangle.
 *
 * Complexity: one DOM parse of document.xml; rendering is O(shapes + text).
 */
import JSZip from 'jszip'
import { DOMParser, XMLSerializer, type Element as XElement, type Node as XNode } from '@xmldom/xmldom'
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { fillRun, registerFonts, renderEmfToPng, renderWmfToPng, SYMBOL_MAP } from './wmf-render'

const EMU_PER_PX = 9525 // 96 dpi
const SCALE = 2 // output pixels per CSS pixel
const MAX_SIDE = 4000
/** Lone text boxes with at least this much text are content, not a drawing (see convert-docx inlineTextboxes). */
const CONTENT_TEXTBOX_CHARS = 25

const NS = {
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
const URI = {
  group: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  canvas: 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  shape: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  picture: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
}

// ---------------------------------------------------------------- DOM helpers

type El = XElement
const isEl = (n: XNode | null | undefined): n is El => !!n && n.nodeType === 1
const kids = (el: El | null | undefined, name?: string): El[] => {
  const out: El[] = []
  if (!el) return out
  for (let n = el.firstChild; n; n = n.nextSibling) if (isEl(n) && (!name || n.nodeName === name)) out.push(n)
  return out
}
const kid = (el: El | null | undefined, name: string) => kids(el, name)[0] ?? null
const desc = (el: El | null | undefined, name: string): El | null =>
  el ? ((el.getElementsByTagName(name)[0] as El | undefined) ?? null) : null
const descAll = (el: El | null | undefined, name: string): El[] =>
  el ? (Array.from(el.getElementsByTagName(name)) as El[]) : []
const num = (el: El | null | undefined, attr: string, def = 0) => {
  const v = el?.getAttribute(attr)
  return v == null || v === '' ? def : Number(v)
}
const ancestor = (el: El, name: string): El | null => {
  for (let n = el.parentNode; n; n = n.parentNode) if (isEl(n) && n.nodeName === name) return n
  return null
}
const textOf = (el: El | null) =>
  el ? [...descAll(el, 'w:t'), ...descAll(el, 'm:t')].map((t) => t.textContent ?? '').join('') : ''

// -------------------------------------------------------------------- colours

type Theme = Record<string, string> // scheme name → hex rrggbb

function readTheme(xml: string | undefined): Theme {
  const theme: Theme = {
    dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31',
    accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72',
  }
  if (!xml) return theme
  for (const m of xml.matchAll(/<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"/g)) {
    theme[m[1]] = m[2]
  }
  return theme
}
const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2', phClr: 'accent1' }

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

/** Colour from a colour-choice parent (a:solidFill, a:lnRef, …): srgbClr/schemeClr/sysClr/prstClr + modifiers. */
function colorOf(parent: El | null, theme: Theme): string | null {
  if (!parent) return null
  const c = kids(parent).find((k) => /^a:(srgbClr|schemeClr|sysClr|prstClr|scrgbClr)$/.test(k.nodeName))
  if (!c) return null
  let hex: string
  if (c.nodeName === 'a:srgbClr') hex = c.getAttribute('val') ?? '000000'
  else if (c.nodeName === 'a:sysClr') hex = c.getAttribute('lastClr') ?? '000000'
  else if (c.nodeName === 'a:schemeClr') {
    const v = c.getAttribute('val') ?? 'dk1'
    hex = theme[SCHEME_ALIAS[v] ?? v] ?? '000000'
  } else if (c.nodeName === 'a:prstClr') {
    const named: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000', yellow: 'FFFF00', gray: '808080' }
    hex = named[c.getAttribute('val') ?? ''] ?? '000000'
  } else hex = '000000'
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  let alpha = 1
  for (const mod of kids(c)) {
    const v = num(mod, 'val') / 100000
    if (mod.nodeName === 'a:lumMod' || mod.nodeName === 'a:lumOff') {
      const [h, s, l] = rgbToHsl(r, g, b)
      const nl = mod.nodeName === 'a:lumMod' ? l * v : l + v
      ;[r, g, b] = hslToRgb(h, s, Math.min(1, Math.max(0, nl)))
    } else if (mod.nodeName === 'a:shade') {
      ;[r, g, b] = [r * v, g * v, b * v]
    } else if (mod.nodeName === 'a:tint') {
      ;[r, g, b] = [r + (255 - r) * (1 - v), g + (255 - g) * (1 - v), b + (255 - b) * (1 - v)]
    } else if (mod.nodeName === 'a:alpha') {
      alpha = v
    }
  }
  const c3 = [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))))
  return alpha < 1 ? `rgba(${c3.join(',')},${alpha})` : `rgb(${c3.join(',')})`
}

function mixColors(a: string, b: string, share: number): string {
  const rgb = (c: string) => (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
  const [x, y] = [rgb(a), rgb(b)]
  return `rgb(${x.map((v, i) => Math.round(v * share + y[i] * (1 - share))).join(',')})`
}

// ------------------------------------------------------------------- geometry

type Cmd =
  | { t: 'M' | 'L'; x: number; y: number }
  | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: 'Q'; x1: number; y1: number; x: number; y: number }
  | { t: 'A'; cx: number; cy: number; rx: number; ry: number; a0: number; a1: number }
  | { t: 'Z' }
interface Geometry {
  paths: { cmds: Cmd[]; fill: boolean; stroke: boolean }[]
  /** Open path: arrow heads apply to its first/last point. */
  open: boolean
}

const poly = (pts: [number, number][], close = true): Cmd[] => [
  ...pts.map(([x, y], i) => ({ t: i ? 'L' : 'M', x, y }) as Cmd),
  ...(close ? [{ t: 'Z' } as Cmd] : []),
]
const ellipseCmds = (w: number, h: number): Cmd[] => [{ t: 'A', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, a0: 0, a1: Math.PI * 2 }]
function roundRect(w: number, h: number, r: number): Cmd[] {
  r = Math.min(r, w / 2, h / 2)
  const k = 0.5523 * r
  return [
    { t: 'M', x: r, y: 0 }, { t: 'L', x: w - r, y: 0 }, { t: 'C', x1: w - r + k, y1: 0, x2: w, y2: r - k, x: w, y: r },
    { t: 'L', x: w, y: h - r }, { t: 'C', x1: w, y1: h - r + k, x2: w - r + k, y2: h, x: w - r, y: h },
    { t: 'L', x: r, y: h }, { t: 'C', x1: r - k, y1: h, x2: 0, y2: h - r + k, x: 0, y: h - r },
    { t: 'L', x: 0, y: r }, { t: 'C', x1: 0, y1: r - k, x2: r - k, y2: 0, x: r, y: 0 }, { t: 'Z' },
  ]
}

function presetGeometry(prst: string, w: number, h: number, adj: Record<string, number>): Geometry {
  const a = (name: string, def: number) => (adj[name] ?? def) / 100000
  const closed = (cmds: Cmd[]): Geometry => ({ paths: [{ cmds, fill: true, stroke: true }], open: false })
  const openLine = (cmds: Cmd[]): Geometry => ({ paths: [{ cmds, fill: false, stroke: true }], open: true })
  const ss = Math.min(w, h)
  switch (prst) {
    case 'line':
    case 'straightConnector1':
      return openLine(poly([[0, 0], [w, h]], false))
    case 'bentConnector2':
      return openLine(poly([[0, 0], [w, 0], [w, h]], false))
    case 'bentConnector3':
    case 'bentConnector4':
    case 'bentConnector5': {
      const x = w * a('adj1', 50000)
      return openLine(poly([[0, 0], [x, 0], [x, h], [w, h]], false))
    }
    case 'curvedConnector2':
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5':
      return openLine([{ t: 'M', x: 0, y: 0 }, { t: 'C', x1: w / 2, y1: 0, x2: w / 2, y2: h, x: w, y: h }])
    case 'ellipse':
    case 'flowChartConnector':
    case 'flowChartOnlineStorage':
    case 'donut':
    case 'blockArc':
    case 'chord':
    case 'pie':
      return closed(ellipseCmds(w, h))
    case 'roundRect':
    case 'flowChartAlternateProcess':
      return closed(roundRect(w, h, ss * a('adj', 16667)))
    case 'flowChartTerminator':
      return closed(roundRect(w, h, h / 2))
    case 'triangle':
    case 'flowChartExtract':
      return closed(poly([[w * a('adj', 50000), 0], [w, h], [0, h]]))
    case 'flowChartMerge':
      return closed(poly([[0, 0], [w, 0], [w / 2, h]]))
    case 'rtTriangle':
      return closed(poly([[0, 0], [0, h], [w, h]]))
    case 'diamond':
    case 'flowChartDecision':
      return closed(poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const d = prst === 'flowChartInputOutput' ? w / 5 : ss * a('adj', 25000)
      return closed(poly([[d, 0], [w, 0], [w - d, h], [0, h]]))
    }
    case 'trapezoid': {
      const d = ss * a('adj', 25000)
      return closed(poly([[d, 0], [w - d, 0], [w, h], [0, h]]))
    }
    case 'flowChartManualOperation':
      return closed(poly([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]))
    case 'flowChartManualInput':
      return closed(poly([[0, h * 0.2], [w, 0], [w, h], [0, h]]))
    case 'hexagon':
    case 'flowChartPreparation': {
      const d = prst === 'hexagon' ? ss * a('adj', 25000) : w / 5
      return closed(poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]))
    }
    case 'octagon': {
      const d = ss * a('adj', 29289)
      return closed(poly([[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]]))
    }
    case 'pentagon':
      return closed(poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]))
    case 'homePlate':
    case 'flowChartOffpageConnector': {
      if (prst === 'flowChartOffpageConnector') return closed(poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]))
      const d = ss * a('adj', 50000)
      return closed(poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]))
    }
    case 'chevron': {
      const d = ss * a('adj', 50000)
      return closed(poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]))
    }
    case 'rightArrow':
    case 'leftArrow':
    case 'upArrow':
    case 'downArrow':
    case 'leftRightArrow': {
      const horiz = prst !== 'upArrow' && prst !== 'downArrow'
      const [L, T] = horiz ? [w, h] : [h, w] // length along the arrow, thickness across
      const shaft = T * a('adj1', 50000)
      const head = Math.min(ss * a('adj2', 50000), L)
      const y0 = (T - shaft) / 2
      const y1 = y0 + shaft
      let pts: [number, number][] =
        prst === 'leftRightArrow'
          ? [[0, T / 2], [head, 0], [head, y0], [L - head, y0], [L - head, 0], [L, T / 2], [L - head, T], [L - head, y1], [head, y1], [head, T]]
          : [[0, y0], [L - head, y0], [L - head, 0], [L, T / 2], [L - head, T], [L - head, y1], [0, y1]]
      if (prst === 'leftArrow') pts = pts.map(([x, y]) => [L - x, y])
      if (!horiz) pts = pts.map(([x, y]) => [y, x])
      if (prst === 'upArrow') pts = pts.map(([x, y]) => [x, h - y])
      return closed(poly(pts))
    }
    case 'star5': {
      const pts: [number, number][] = []
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 ? 0.38 : 1
        pts.push([w / 2 + (w / 2) * r * Math.cos(ang), h / 2 + (h / 2) * r * Math.sin(ang)])
      }
      return closed(poly(pts))
    }
    case 'arc': {
      const a0 = ((adj.adj1 ?? 16200000) / 60000) * (Math.PI / 180)
      const a1 = ((adj.adj2 ?? 0) / 60000) * (Math.PI / 180)
      return { paths: [{ cmds: [{ t: 'A', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, a0, a1: a1 <= a0 ? a1 + Math.PI * 2 : a1 }], fill: false, stroke: true }], open: true }
    }
    case 'flowChartPredefinedProcess':
      return {
        paths: [
          { cmds: poly([[0, 0], [w, 0], [w, h], [0, h]]), fill: true, stroke: true },
          { cmds: [...poly([[w / 8, 0], [w / 8, h]], false), ...poly([[(w * 7) / 8, 0], [(w * 7) / 8, h]], false)], fill: false, stroke: true },
        ],
        open: false,
      }
    case 'flowChartDocument':
    case 'flowChartMultidocument':
      return closed([
        { t: 'M', x: 0, y: 0 }, { t: 'L', x: w, y: 0 }, { t: 'L', x: w, y: h * 0.83 },
        { t: 'C', x1: w * 0.75, y1: h * 0.7, x2: w * 0.5, y2: h * 1.05, x: 0, y: h * 0.9 }, { t: 'Z' },
      ])
    case 'can':
    case 'flowChartMagneticDisk': {
      const e = h * 0.12
      return {
        paths: [
          { cmds: [{ t: 'M', x: 0, y: e }, { t: 'L', x: 0, y: h - e }, { t: 'A', cx: w / 2, cy: h - e, rx: w / 2, ry: e, a0: Math.PI, a1: 0 }, { t: 'L', x: w, y: e }, { t: 'A', cx: w / 2, cy: e, rx: w / 2, ry: e, a0: 0, a1: -Math.PI }, { t: 'Z' }], fill: true, stroke: true },
          { cmds: [{ t: 'A', cx: w / 2, cy: e, rx: w / 2, ry: e, a0: 0, a1: Math.PI }], fill: false, stroke: true },
        ],
        open: false,
      }
    }
    case 'plus':
    case 'mathPlus': {
      const d = ss * a('adj', 25000)
      return closed(poly([[d, 0], [w - d, 0], [w - d, d], [w, d], [w, h - d], [w - d, h - d], [w - d, h], [d, h], [d, h - d], [0, h - d], [0, d], [d, d]]))
    }
    default:
      // rect, flowChartProcess, callouts, frames, …: the bounding box.
      return closed(poly([[0, 0], [w, 0], [w, h], [0, h]]))
  }
}

function customGeometry(g: El, w: number, h: number): Geometry {
  const paths: Geometry['paths'] = []
  let open = true
  for (const p of descAll(g, 'a:path')) {
    const pw = num(p, 'w', w) || w
    const ph = num(p, 'h', h) || h
    const X = (el: El) => (num(el, 'x') / pw) * w
    const Y = (el: El) => (num(el, 'y') / ph) * h
    const cmds: Cmd[] = []
    let last = { x: 0, y: 0 }
    for (const c of kids(p)) {
      const pts = kids(c, 'a:pt')
      if (c.nodeName === 'a:moveTo' && pts[0]) cmds.push({ t: 'M', x: X(pts[0]), y: Y(pts[0]) })
      else if (c.nodeName === 'a:lnTo' && pts[0]) cmds.push({ t: 'L', x: X(pts[0]), y: Y(pts[0]) })
      else if (c.nodeName === 'a:cubicBezTo' && pts.length === 3)
        cmds.push({ t: 'C', x1: X(pts[0]), y1: Y(pts[0]), x2: X(pts[1]), y2: Y(pts[1]), x: X(pts[2]), y: Y(pts[2]) })
      else if (c.nodeName === 'a:quadBezTo' && pts.length === 2) cmds.push({ t: 'Q', x1: X(pts[0]), y1: Y(pts[0]), x: X(pts[1]), y: Y(pts[1]) })
      else if (c.nodeName === 'a:arcTo') {
        // Approximated by a straight line to the arc's end point.
        const wR = (num(c, 'wR') / pw) * w
        const hR = (num(c, 'hR') / ph) * h
        const st = (num(c, 'stAng') / 60000) * (Math.PI / 180)
        const sw = (num(c, 'swAng') / 60000) * (Math.PI / 180)
        const cx = last.x - wR * Math.cos(st)
        const cy = last.y - hR * Math.sin(st)
        cmds.push({ t: 'A', cx, cy, rx: wR, ry: hR, a0: st, a1: st + sw })
      } else if (c.nodeName === 'a:close') {
        cmds.push({ t: 'Z' })
        open = false
      }
      const lastCmd = cmds.at(-1)
      if (lastCmd && 'x' in lastCmd) last = { x: lastCmd.x, y: lastCmd.y }
    }
    paths.push({ cmds, fill: p.getAttribute('fill') !== 'none', stroke: p.getAttribute('stroke') !== 'false' })
  }
  return { paths, open }
}

function tracePath(ctx: SKRSContext2D, cmds: Cmd[]) {
  ctx.beginPath()
  for (const c of cmds) {
    if (c.t === 'M') ctx.moveTo(c.x, c.y)
    else if (c.t === 'L') ctx.lineTo(c.x, c.y)
    else if (c.t === 'C') ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y)
    else if (c.t === 'Q') ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y)
    else if (c.t === 'A') ctx.ellipse(c.cx, c.cy, Math.max(c.rx, 0.01), Math.max(c.ry, 0.01), 0, c.a0, c.a1, c.a1 < c.a0)
    else ctx.closePath()
  }
}

/** First and last segment directions of a path, for arrow heads. */
function endpoints(cmds: Cmd[]): { start: [number, number, number, number]; end: [number, number, number, number] } | null {
  const pts: [number, number][] = []
  for (const c of cmds) {
    if (c.t === 'M' || c.t === 'L') pts.push([c.x, c.y])
    else if (c.t === 'C') pts.push([c.x2, c.y2], [c.x, c.y])
    else if (c.t === 'Q') pts.push([c.x1, c.y1], [c.x, c.y])
    else if (c.t === 'A') {
      pts.push([c.cx + c.rx * Math.cos(c.a0), c.cy + c.ry * Math.sin(c.a0)])
      const a = c.a0 + (c.a1 - c.a0) * 0.98
      pts.push([c.cx + c.rx * Math.cos(a), c.cy + c.ry * Math.sin(a)], [c.cx + c.rx * Math.cos(c.a1), c.cy + c.ry * Math.sin(c.a1)])
    }
  }
  if (pts.length < 2) return null
  // tip x,y + a point the line comes from
  return { start: [...pts[0], ...pts[1]], end: [...pts[pts.length - 1], ...pts[pts.length - 2]] }
}

/** lineW and minW are in the current (group-local) units; minW = 0.5 pt converted by the caller. */
function arrowHead(ctx: SKRSContext2D, end: El | null, seg: [number, number, number, number], lineW: number, color: string, minW: number) {
  const type = end?.getAttribute('type')
  if (!end || !type || type === 'none') return
  const size = (v: string | null) => (v === 'sm' ? 2 : v === 'lg' ? 5 : 3)
  const len = Math.max(lineW, minW) * size(end.getAttribute('len'))
  const wid = Math.max(lineW, minW) * size(end.getAttribute('w'))
  const [tx, ty, fx, fy] = seg
  const ang = Math.atan2(ty - fy, tx - fx)
  ctx.save()
  ctx.translate(tx, ty)
  ctx.rotate(ang)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.beginPath()
  if (type === 'oval') ctx.ellipse(-len / 2, 0, len / 2, wid / 2, 0, 0, Math.PI * 2)
  else if (type === 'diamond') {
    ctx.moveTo(0, 0); ctx.lineTo(-len / 2, -wid / 2); ctx.lineTo(-len, 0); ctx.lineTo(-len / 2, wid / 2)
  } else if (type === 'arrow') {
    ctx.moveTo(-len, -wid / 2); ctx.lineTo(0, 0); ctx.lineTo(-len, wid / 2)
    ctx.lineWidth = lineW
    ctx.stroke()
    ctx.restore()
    return
  } else if (type === 'stealth') {
    ctx.moveTo(0, 0); ctx.lineTo(-len, -wid / 2); ctx.lineTo(-len * 0.7, 0); ctx.lineTo(-len, wid / 2)
  } else {
    ctx.moveTo(0, 0); ctx.lineTo(-len, -wid / 2); ctx.lineTo(-len, wid / 2)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// ---------------------------------------------------------- text + formulas

interface Ctx {
  ctx: SKRSContext2D
  theme: Theme
  images: Map<string, Buffer> // rId → image bytes (from document rels)
  /** Canvas pixels per EMU at the drawing's top level (no group scaling). */
  k: number
}

/**
 * Group scaling currently applied (x, y). DrawingML scales child geometry
 * with the group but NOT line widths or text sizes, so those are divided by it.
 */
function groupScale(c: Ctx): [number, number] {
  const m = c.ctx.getTransform()
  return [Math.hypot(m.a, m.b) / c.k || 1, Math.hypot(m.c, m.d) / c.k || 1]
}

interface Style {
  size: number // EMU
  bold: boolean
  italic: boolean
  sans: boolean
  color: string
  vert?: 'sup' | 'sub'
}

const EMU_PER_PT = 12700

/** Canvas font string. Sizes are passed in pt: Skia can't render the huge px sizes EMU units would give. */
function fontFor(s: Style, mathVar = false) {
  const style = `${s.bold ? 'Bold' : ''}${s.italic ? 'Italic' : ''}`
  // Math variables: KaTeX math italic, DejaVu for glyphs it lacks. Text: DejaVu (≈ Calibri/Times metrics).
  const fam = mathVar ? 'WmfMathItalic, DVSerifItalic' : s.sans ? `DVSansCond${style}` : `DVSerif${style}`
  return `${(s.size / EMU_PER_PT).toFixed(3)}px ${fam}`
}

/** A laid-out piece of inline content: width, ascent/descent above/below baseline (EMU), painter. */
interface Box {
  w: number
  asc: number
  desc: number
  draw: (x: number, baseline: number) => void
}


function textBox(c: Ctx, text: string, s: Style, mathVar = false): Box {
  const { ctx } = c
  ctx.font = fontFor(s, mathVar)
  const chars = Array.from(text.replace(/\u00a0/g, ' '))
  // KaTeX math font has no space glyph (measures 0): use a quarter em there.
  const adv = (ch: string) => (ch === ' ' && mathVar ? (s.size / EMU_PER_PT) * 0.25 : ctx.measureText(ch).width)
  const w = chars.reduce((sum, ch) => sum + adv(ch), 0) * EMU_PER_PT
  return {
    w,
    asc: s.size * 0.8,
    desc: s.size * 0.25,
    draw: (x, baseline) => {
      ctx.save()
      ctx.translate(x, baseline)
      ctx.scale(EMU_PER_PT, EMU_PER_PT) // draw in pt units
      ctx.font = fontFor(s, mathVar)
      ctx.fillStyle = s.color
      ctx.textBaseline = 'alphabetic'
      fillRun(ctx, chars, 0, 0, chars.map(adv), s.size / EMU_PER_PT, false)
      ctx.restore()
    },
  }
}

const hbox = (boxes: Box[]): Box => ({
  w: boxes.reduce((s, b) => s + b.w, 0),
  asc: Math.max(0, ...boxes.map((b) => b.asc)),
  desc: Math.max(0, ...boxes.map((b) => b.desc)),
  draw: (x, y) => {
    for (const b of boxes) {
      b.draw(x, y)
      x += b.w
    }
  },
})

function imageBox(c: Ctx, png: Buffer, w: number, h: number): Box {
  const pending = loadImage(png)
  const box: Box = { w, asc: h * 0.8, desc: h * 0.2, draw: () => {} }
  // Images are drawn after loading; drawText awaits `c.pending` (see renderGraphic).
  pendingDraws.push(
    pending.then((img) => {
      box.draw = (x, y) => c.ctx.drawImage(img, x, y - box.asc, w, h)
    })
  )
  return box
}
let pendingDraws: Promise<unknown>[] = []

// OMML (Word formulas) → boxes. Subset, see file header.
function mathBox(c: Ctx, el: El, s: Style): Box {
  const small = (st: Style): Style => ({ ...st, size: st.size * 0.7 })
  const children = (e: El | null, st = s) => hbox(kids(e).map((k) => mathBox(c, k, st)))
  const arg = (name: string, st = s) => children(kid(el, name), st)
  switch (el.nodeName) {
    case 'm:r': {
      const t = kids(el, 'm:t').map((x) => x.textContent ?? '').join('')
      const plain = kid(kid(el, 'm:rPr'), 'm:sty')?.getAttribute('m:val') === 'p'
      // Letters italic (math variables), digits/operators upright.
      const parts = t.match(/[A-Za-zα-ωΑ-Ω]+|[^A-Za-zα-ωΑ-Ω]+/g) ?? []
      return hbox(parts.map((p) => textBox(c, p.replace(/-/g, '−'), s, !plain && /^[A-Za-zα-ω]/.test(p))))
    }
    case 'm:sSub':
    case 'm:sSup':
    case 'm:sSubSup': {
      const base = arg('m:e')
      const sub = kid(el, 'm:sub') ? arg('m:sub', small(s)) : null
      const sup = kid(el, 'm:sup') ? arg('m:sup', small(s)) : null
      const w = base.w + Math.max(sub?.w ?? 0, sup?.w ?? 0)
      return {
        w,
        asc: Math.max(base.asc, sup ? s.size * 0.45 + sup.asc : 0),
        desc: Math.max(base.desc, sub ? s.size * 0.2 + sub.desc : 0),
        draw: (x, y) => {
          base.draw(x, y)
          sup?.draw(x + base.w, y - s.size * 0.45)
          sub?.draw(x + base.w, y + s.size * 0.2)
        },
      }
    }
    case 'm:sPre': {
      const base = arg('m:e')
      const sub = arg('m:sub', small(s))
      const sup = arg('m:sup', small(s))
      const pw = Math.max(sub.w, sup.w)
      return {
        w: pw + base.w, asc: base.asc + s.size * 0.3, desc: base.desc + s.size * 0.2,
        draw: (x, y) => { sup.draw(x, y - s.size * 0.45); sub.draw(x, y + s.size * 0.2); base.draw(x + pw, y) },
      }
    }
    case 'm:f': {
      const numr = arg('m:num', small(s))
      const den = arg('m:den', small(s))
      if (kid(kid(el, 'm:fPr'), 'm:type')?.getAttribute('val') === 'lin') return hbox([numr, textBox(c, '/', s), den])
      const w = Math.max(numr.w, den.w) + s.size * 0.2
      const axis = s.size * 0.3
      return {
        w,
        asc: axis + numr.asc + numr.desc + s.size * 0.1,
        desc: -axis + den.asc + den.desc + s.size * 0.1,
        draw: (x, y) => {
          numr.draw(x + (w - numr.w) / 2, y - axis - numr.desc - s.size * 0.08)
          den.draw(x + (w - den.w) / 2, y - axis + den.asc + s.size * 0.08)
          c.ctx.strokeStyle = s.color
          c.ctx.lineWidth = s.size * 0.05
          c.ctx.beginPath()
          c.ctx.moveTo(x + s.size * 0.05, y - axis)
          c.ctx.lineTo(x + w - s.size * 0.05, y - axis)
          c.ctx.stroke()
        },
      }
    }
    case 'm:acc':
    case 'm:bar':
    case 'm:groupChr': {
      const base = arg('m:e')
      const pr = kid(el, el.nodeName === 'm:acc' ? 'm:accPr' : el.nodeName === 'm:bar' ? 'm:barPr' : 'm:groupChrPr')
      const chr = kid(pr, 'm:chr')?.getAttribute('m:val') ?? (el.nodeName === 'm:acc' ? '̂' : '̅')
      const below = kid(pr, 'm:pos')?.getAttribute('m:val') === 'bot'
      const vector = chr === '⃗' || chr === '→' || chr === '⃑'
      const bar = chr === '̅' || chr === '¯' || el.nodeName === 'm:bar'
      const extra = s.size * 0.35
      return {
        w: base.w,
        asc: base.asc + (below ? 0 : extra),
        desc: base.desc + (below ? extra : 0),
        draw: (x, y) => {
          base.draw(x, y)
          const ctx = c.ctx
          const yy = below ? y + base.desc + extra * 0.4 : y - base.asc - extra * 0.25
          ctx.strokeStyle = s.color
          ctx.fillStyle = s.color
          ctx.lineWidth = s.size * 0.05
          if (vector || bar) {
            ctx.beginPath()
            ctx.moveTo(x + s.size * 0.05, yy)
            ctx.lineTo(x + base.w - s.size * 0.02, yy)
            ctx.stroke()
            if (vector) {
              const hx = x + base.w - s.size * 0.02
              ctx.beginPath()
              ctx.moveTo(hx, yy)
              ctx.lineTo(hx - s.size * 0.18, yy - s.size * 0.09)
              ctx.lineTo(hx - s.size * 0.18, yy + s.size * 0.09)
              ctx.closePath()
              ctx.fill()
            }
          } else {
            const mark = chr === '̃' ? '~' : chr === '̇' ? '˙' : chr === '̈' ? '¨' : '^'
            const b = textBox(c, mark, { ...s, size: s.size * 0.8 })
            b.draw(x + (base.w - b.w) / 2, yy + s.size * 0.35)
          }
        },
      }
    }
    case 'm:d': {
      const pr = kid(el, 'm:dPr')
      const beg = kid(pr, 'm:begChr')?.getAttribute('m:val') ?? '('
      const end = kid(pr, 'm:endChr')?.getAttribute('m:val') ?? ')'
      const sep = kid(pr, 'm:sepChr')?.getAttribute('m:val') ?? '|'
      const parts: Box[] = []
      kids(el, 'm:e').forEach((e, i) => {
        if (i) parts.push(textBox(c, sep, s))
        parts.push(children(e))
      })
      const inner = hbox(parts)
      const tall = inner.asc + inner.desc > s.size * 1.3
      if (!tall) return hbox([textBox(c, beg, s), inner, textBox(c, end, s)].filter((b) => b.w))
      // Tall content: draw the delimiters as strokes spanning it.
      const dw = s.size * 0.35
      const stroke = (ch: string, x: number, top: number, bot: number, left: boolean) => {
        const ctx = c.ctx
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.size * 0.06
        ctx.beginPath()
        const [x0, x1] = left ? [x + dw * 0.8, x + dw * 0.2] : [x + dw * 0.2, x + dw * 0.8]
        const mid = (top + bot) / 2
        if (ch === '(' || ch === ')') {
          ctx.moveTo(x0, top)
          ctx.quadraticCurveTo(x1 - (x0 - x1) * 0.6, mid, x0, bot)
        } else if (ch === '[' || ch === ']') {
          ctx.moveTo(x0, top); ctx.lineTo(x1, top); ctx.lineTo(x1, bot); ctx.lineTo(x0, bot)
        } else if (ch === '{' || ch === '}') {
          const xm = x1 - (x0 - x1) * 0.3
          ctx.moveTo(x0, top); ctx.quadraticCurveTo(x1, top, x1, top + (mid - top) * 0.5)
          ctx.lineTo(x1, mid - dw * 0.3); ctx.quadraticCurveTo(x1, mid, xm, mid)
          ctx.quadraticCurveTo(x1, mid, x1, mid + dw * 0.3); ctx.lineTo(x1, bot - (bot - mid) * 0.5)
          ctx.quadraticCurveTo(x1, bot, x0, bot)
        } else if (ch === '|' || ch === '‖') {
          ctx.moveTo(x + dw / 2, top); ctx.lineTo(x + dw / 2, bot)
        } else if (ch === '⟨' || ch === '〈' || ch === '⟩' || ch === '〉') {
          ctx.moveTo(x0, top); ctx.lineTo(x1, mid); ctx.lineTo(x0, bot)
        } else if (ch) {
          ctx.moveTo(x0, top); ctx.lineTo(x0, bot)
        }
        ctx.stroke()
      }
      const lw = beg ? dw : 0
      const rw = end ? dw : 0
      return {
        w: lw + inner.w + rw,
        asc: inner.asc + s.size * 0.1,
        desc: inner.desc + s.size * 0.1,
        draw: (x, y) => {
          const top = y - inner.asc - s.size * 0.05
          const bot = y + inner.desc + s.size * 0.05
          if (beg) stroke(beg, x, top, bot, true)
          inner.draw(x + lw, y)
          if (end) stroke(end, x + lw + inner.w, top, bot, false)
        },
      }
    }
    case 'm:rad': {
      const base = arg('m:e')
      const root = textBox(c, '√', { ...s, size: (base.asc + base.desc) * 1.05 })
      return {
        w: root.w + base.w,
        asc: base.asc + s.size * 0.15,
        desc: base.desc,
        draw: (x, y) => {
          root.draw(x, y + base.desc * 0.8)
          base.draw(x + root.w, y)
          c.ctx.strokeStyle = s.color
          c.ctx.lineWidth = s.size * 0.05
          c.ctx.beginPath()
          c.ctx.moveTo(x + root.w * 0.95, y - base.asc - s.size * 0.1)
          c.ctx.lineTo(x + root.w + base.w, y - base.asc - s.size * 0.1)
          c.ctx.stroke()
        },
      }
    }
    case 'm:nary': {
      const chr = kid(kid(el, 'm:naryPr'), 'm:chr')?.getAttribute('m:val') ?? '∫'
      const op = textBox(c, chr, { ...s, size: s.size * 1.4 })
      const sub = kid(el, 'm:sub') ? arg('m:sub', small(s)) : hbox([])
      const sup = kid(el, 'm:sup') ? arg('m:sup', small(s)) : hbox([])
      const body = arg('m:e')
      const lw = Math.max(op.w, sub.w, sup.w)
      return {
        w: lw + body.w + s.size * 0.1,
        asc: Math.max(body.asc, s.size * 1.2 + sup.asc),
        desc: Math.max(body.desc, s.size * 0.5 + sub.desc),
        draw: (x, y) => {
          op.draw(x + (lw - op.w) / 2, y + s.size * 0.25)
          sup.draw(x + (lw - sup.w) / 2 + s.size * 0.2, y - s.size * 1.15)
          sub.draw(x + (lw - sub.w) / 2, y + s.size * 0.6)
          body.draw(x + lw + s.size * 0.1, y)
        },
      }
    }
    case 'm:func':
      return hbox([arg('m:fName'), textBox(c, ' ', s), arg('m:e')])
    case 'm:eqArr':
    case 'm:m': {
      const rows = el.nodeName === 'm:m' ? kids(el, 'm:mr').map((r) => hbox(kids(r, 'm:e').map((e) => children(e)))) : kids(el, 'm:e').map((e) => children(e))
      const lh = s.size * 1.3
      const w = Math.max(0, ...rows.map((r) => r.w))
      const hTot = rows.length * lh
      return {
        w,
        asc: hTot / 2 + s.size * 0.3,
        desc: hTot / 2 - s.size * 0.3,
        draw: (x, y) => rows.forEach((r, i) => r.draw(x, y - hTot / 2 + s.size * 0.3 + lh * (i + 0.75))),
      }
    }
    case 'm:t':
      return textBox(c, el.textContent ?? '', s, true)
    case 'm:oMath':
    case 'm:e':
    case 'm:box':
    case 'm:borderBox':
    case 'm:limLow':
    case 'm:limUpp':
      return hbox(kids(el).filter((k) => !k.nodeName.endsWith('Pr')).map((k) => mathBox(c, k, s)))
    default:
      if (el.nodeName.endsWith('Pr') || el.nodeName === 'm:ctrlPr' || el.nodeName.startsWith('w:')) return hbox([])
      return hbox(kids(el).map((k) => mathBox(c, k, s)))
  }
}

function runStyle(r: El | null, base: Style, c: Ctx): Style {
  const pr = kid(r, 'w:rPr')
  if (!pr) return base
  const s = { ...base }
  const sz = kid(pr, 'w:sz')?.getAttribute('w:val')
  if (sz) s.size = (Number(sz) / 2) * 12700
  const on = (name: string) => {
    const e = kid(pr, name)
    return e ? e.getAttribute('w:val') !== '0' && e.getAttribute('w:val') !== 'false' : undefined
  }
  s.bold = on('w:b') ?? s.bold
  s.italic = on('w:i') ?? s.italic
  const color = kid(pr, 'w:color')?.getAttribute('w:val')
  if (color && color !== 'auto') s.color = `#${color}`
  const theme = kid(pr, 'w:color')?.getAttribute('w:themeColor')
  if (theme) s.color = `#${c.theme[SCHEME_ALIAS[theme] ?? theme] ?? '000000'}`
  const rf = kid(pr, 'w:rFonts')
  const font = rf?.getAttribute('w:ascii') ?? rf?.getAttribute('w:hAnsi') ?? rf?.getAttribute('w:cs') ?? ''
  if (font) s.sans = !/times|cambria|georgia|garamond|serif|symbol/i.test(font) || /sans/i.test(font)
  if (/symbol/i.test(font)) (s as Style & { symbol?: boolean }).symbol = true
  const va = kid(pr, 'w:vertAlign')?.getAttribute('w:val')
  if (va === 'superscript') s.vert = 'sup'
  else if (va === 'subscript') s.vert = 'sub'
  return s
}

/** Inline content of one paragraph (runs, formulas, legacy formula objects, images) as word-ish boxes. */
function paragraphBoxes(c: Ctx, p: El, base: Style): { boxes: { box: Box; space: boolean }[] } {
  const out: { box: Box; space: boolean }[] = []
  const pushText = (text: string, s: Style) => {
    const sym = (s as Style & { symbol?: boolean }).symbol
    if (sym) text = Array.from(text, (ch) => SYMBOL_MAP[ch.charCodeAt(0) & 0xff] ?? ch).join('')
    // Symbol-font characters stored in the private-use range (U+F020–F0FF), whatever the run font says.
    text = text.replace(/[\uF020-\uF0FF]/g, (ch) => SYMBOL_MAP[ch.charCodeAt(0) & 0xff] ?? String.fromCharCode(ch.charCodeAt(0) & 0xff))
    const vs = s.vert ? { ...s, size: s.size * 0.65 } : s
    const shift = s.vert === 'sup' ? -s.size * 0.35 : s.vert === 'sub' ? s.size * 0.15 : 0
    // Break points: whitespace, and after / - _ so long URLs can wrap.
    for (const part of text.split(/(\s+)/).flatMap((t) => (/^\s+$/.test(t) ? [t] : t.split(/(?<=[/\-_])/)))) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        out.push({ box: textBox(c, ' ', vs), space: true })
        continue
      }
      const b = textBox(c, part, vs)
      out.push({ box: shift ? { ...b, draw: (x, y) => b.draw(x, y + shift) } : b, space: false })
    }
  }
  const walk = (el: El, s: Style) => {
    for (const k of kids(el)) {
      switch (k.nodeName) {
        case 'w:r': {
          const rs = runStyle(k, s, c)
          for (const part of kids(k)) {
            if (part.nodeName === 'w:t') pushText(part.textContent ?? '', rs)
            else if (part.nodeName === 'w:tab') pushText('    ', rs)
            else if (part.nodeName === 'w:sym') {
              const code = parseInt(part.getAttribute('w:char') ?? '20', 16) & 0xff
              pushText(SYMBOL_MAP[code] ?? String.fromCharCode(code), rs)
            } else if (part.nodeName === 'w:object') {
              // Legacy formula: its WMF preview.
              const shape = desc(part, 'v:shape')
              const id = desc(part, 'v:imagedata')?.getAttribute('r:id')
              const png = id ? c.images.get(`${id}#png`) ?? c.images.get(id) : undefined
              const st = shape?.getAttribute('style') ?? ''
              const pt = (k2: string) => Number(st.match(new RegExp(`${k2}:([\\d.]+)pt`))?.[1] ?? 0) * 12700
              if (png && pt('width') && pt('height')) out.push({ box: imageBox(c, png, pt('width'), pt('height')), space: false })
            } else if (part.nodeName === 'w:drawing') {
              const blip = desc(part, 'a:blip')?.getAttribute('r:embed')
              const ext = desc(part, 'wp:extent')
              const data = blip ? c.images.get(blip) : undefined
              if (data && ext) out.push({ box: imageBox(c, data, num(ext, 'cx'), num(ext, 'cy')), space: false })
            }
          }
          break
        }
        case 'm:oMath':
          out.push({ box: mathBox(c, k, { ...s, italic: false, sans: false }), space: false })
          break
        case 'm:oMathPara':
          for (const m of kids(k, 'm:oMath')) out.push({ box: mathBox(c, m, { ...s, italic: false, sans: false }), space: false })
          break
        case 'w:hyperlink':
        case 'w:smartTag':
        case 'w:ins':
        case 'w:sdtContent':
        case 'w:sdt':
        case 'mc:AlternateContent':
        case 'mc:Choice':
          walk(k, s)
          break
        default:
          break
      }
    }
  }
  walk(p, base)
  return { boxes: out }
}

/** Lays out w:txbxContent paragraphs inside a box of width w (EMU); returns total height and painter. */
function layoutText(c: Ctx, content: El, w: number): { h: number; draw: (x: number, y: number) => void } {
  const lines: { boxes: Box[]; w: number; asc: number; desc: number; jc: string }[] = []
  const base: Style = { size: 11 * 12700, bold: false, italic: false, sans: true, color: '#000' }
  for (const p of kids(content, 'w:p')) {
    const pPr = kid(p, 'w:pPr')
    const jc = kid(pPr, 'w:jc')?.getAttribute('w:val') ?? 'left'
    const pStyle = runStyle(kid(pPr, 'w:rPr') ? (pPr as El) : null, base, c)
    const { boxes } = paragraphBoxes(c, p, pStyle)
    let line: { box: Box; space: boolean }[] = []
    let lw = 0
    const flush = () => {
      while (line.length && line[line.length - 1].space) line.pop() // no trailing spaces
      const bs = line.map((l) => l.box)
      lines.push({ boxes: bs, w: bs.reduce((s, b) => s + b.w, 0), asc: Math.max(pStyle.size * 0.8, ...bs.map((b) => b.asc)), desc: Math.max(pStyle.size * 0.25, ...bs.map((b) => b.desc)), jc })
      line = []
      lw = 0
    }
    for (const item of boxes) {
      if (lw + item.box.w > w && line.length && !item.space) flush()
      if (item.space && !line.length) continue
      line.push(item)
      lw += item.box.w
    }
    flush()
  }
  const h = lines.reduce((s, l) => s + (l.asc + l.desc) * 1.1, 0)
  return {
    h,
    draw: (x, y) => {
      for (const l of lines) {
        y += l.asc * 1.05
        let lx = l.jc === 'center' ? x + (w - l.w) / 2 : l.jc === 'right' || l.jc === 'end' ? x + w - l.w : x
        for (const b of l.boxes) {
          b.draw(lx, y)
          lx += b.w
        }
        y += l.desc * 1.15
      }
    },
  }
}

// ------------------------------------------------------------------- shapes

interface Xfrm {
  x: number
  y: number
  w: number
  h: number
  rot: number
  flipH: boolean
  flipV: boolean
}
function readXfrm(x: El | null): Xfrm | null {
  if (!x) return null
  const off = kid(x, 'a:off')
  const ext = kid(x, 'a:ext')
  return {
    x: num(off, 'x'), y: num(off, 'y'), w: num(ext, 'cx'), h: num(ext, 'cy'),
    rot: (num(x, 'rot') / 60000) * (Math.PI / 180),
    flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1',
  }
}

function withXfrm(ctx: SKRSContext2D, xf: Xfrm, fn: () => void, flipContent = true) {
  ctx.save()
  ctx.translate(xf.x + xf.w / 2, xf.y + xf.h / 2)
  if (xf.rot) ctx.rotate(xf.rot)
  if (flipContent) ctx.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1)
  ctx.translate(-xf.w / 2, -xf.h / 2)
  fn()
  ctx.restore()
}

async function drawShape(c: Ctx, sp: El) {
  const { ctx, theme } = c
  const spPr = kid(sp, 'wps:spPr') ?? kid(sp, 'pic:spPr')
  const xf = readXfrm(kid(spPr, 'a:xfrm'))
  if (!xf) return
  const style = kid(sp, 'wps:style')
  const prst = kid(spPr, 'a:prstGeom')
  const adj: Record<string, number> = {}
  for (const gd of descAll(prst, 'a:gd')) {
    const m = (gd.getAttribute('fmla') ?? '').match(/^val (-?\d+)/)
    if (m) adj[gd.getAttribute('name') ?? ''] = Number(m[1])
  }
  const cust = kid(spPr, 'a:custGeom')
  const geom = cust ? customGeometry(cust, xf.w, xf.h) : presetGeometry(prst?.getAttribute('prst') ?? 'rect', xf.w, xf.h, adj)

  // Fill: explicit in spPr, else the style reference (idx 0 = none).
  let fill: string | null = null
  if (kid(spPr, 'a:noFill')) fill = null
  else if (kid(spPr, 'a:solidFill')) fill = colorOf(kid(spPr, 'a:solidFill'), theme)
  else if (kid(spPr, 'a:gradFill')) fill = colorOf(desc(kid(spPr, 'a:gradFill'), 'a:gs'), theme)
  else if (kid(spPr, 'a:pattFill')) {
    // Hatch patterns are drawn as their average colour (fg share from pctNN, else ~30 %).
    const pf = kid(spPr, 'a:pattFill')
    const share = Number(pf?.getAttribute('prst')?.match(/^pct(\d+)/)?.[1] ?? 30) / 100
    fill = mixColors(colorOf(kid(pf, 'a:fgClr'), theme) ?? 'rgb(0,0,0)', colorOf(kid(pf, 'a:bgClr'), theme) ?? 'rgb(255,255,255)', share)
  }
  else if (num(kid(style, 'a:fillRef'), 'idx') > 0) fill = colorOf(kid(style, 'a:fillRef'), theme)

  const ln = kid(spPr, 'a:ln')
  let stroke: string | null = null
  if (ln && kid(ln, 'a:noFill')) stroke = null
  else if (ln && kid(ln, 'a:solidFill')) stroke = colorOf(kid(ln, 'a:solidFill'), theme)
  else if (num(kid(style, 'a:lnRef'), 'idx') > 0) stroke = colorOf(kid(style, 'a:lnRef'), theme)
  else if (ln && kid(ln, 'a:gradFill')) stroke = colorOf(desc(kid(ln, 'a:gradFill'), 'a:gs'), theme)
  const lineW = num(ln, 'w', num(kid(style, 'a:lnRef'), 'idx') > 1 ? 19050 : 12700)
  const dash = kid(ln, 'a:prstDash')?.getAttribute('val')

  withXfrm(ctx, xf, () => {
    const [gsx, gsy] = groupScale(c)
    const lw = lineW / ((gsx + gsy) / 2) // absolute width in local units
    for (const p of geom.paths) {
      tracePath(ctx, p.cmds)
      if (p.fill && fill && !geom.open) {
        ctx.fillStyle = fill
        ctx.fill()
      }
      if (p.stroke && stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = lw
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.setLineDash(
          dash && dash !== 'solid'
            ? dash.includes('dot') || dash === 'sysDot' ? [lw, lw * 2] : [lw * 4, lw * 3]
            : []
        )
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    if (stroke && geom.open && geom.paths[0]) {
      const ends = endpoints(geom.paths[0].cmds)
      if (ends) {
        const minW = 6350 / ((gsx + gsy) / 2)
        arrowHead(ctx, kid(ln, 'a:headEnd'), ends.start, lw, stroke, minW)
        arrowHead(ctx, kid(ln, 'a:tailEnd'), ends.end, lw, stroke, minW)
      }
    }
  })

  // Text box: laid out unrotated-flip (Word doesn't mirror text), rotated with the shape.
  const content = desc(kid(sp, 'wps:txbx'), 'w:txbxContent')
  if (content) {
    const body = kid(sp, 'wps:bodyPr')
    const vert = body?.getAttribute('vert')
    const l = num(body, 'lIns', 91440), t = num(body, 'tIns', 45720), r = num(body, 'rIns', 91440), b = num(body, 'bIns', 45720)
    const vertical = vert === 'vert' || vert === 'vert270'
    const [gsx, gsy] = groupScale(c)
    // Text is laid out in absolute units: box size × group scale, insets as-is.
    const boxW = (vertical ? xf.h * gsy : xf.w * gsx) - l - r
    const boxH = (vertical ? xf.w * gsx : xf.h * gsy) - t - b
    const text = layoutText(c, content, Math.max(boxW, 12700))
    await Promise.all(pendingDraws)
    pendingDraws = []
    withXfrm(ctx, xf, () => {
      ctx.scale(1 / gsx, 1 / gsy)
      if (vertical) {
        ctx.translate(vert === 'vert' ? xf.w * gsx : 0, vert === 'vert' ? 0 : xf.h * gsy)
        ctx.rotate(vert === 'vert' ? Math.PI / 2 : -Math.PI / 2)
      }
      const anchor = body?.getAttribute('anchor') ?? 't'
      const dy = anchor === 'ctr' ? (boxH - text.h) / 2 : anchor === 'b' ? boxH - text.h : 0
      text.draw(l, t + Math.max(dy, 0))
    }, false)
  }
}

async function drawPicture(c: Ctx, pic: El) {
  const xf = readXfrm(kid(kid(pic, 'pic:spPr'), 'a:xfrm'))
  const id = desc(pic, 'a:blip')?.getAttribute('r:embed')
  const data = id ? c.images.get(id) : undefined
  if (!xf || !data) return
  const img = await loadImage(data).catch(() => null)
  if (!img) return
  const src = desc(kid(pic, 'pic:blipFill'), 'a:srcRect')
  const [l, t, r, b] = ['l', 't', 'r', 'b'].map((k) => num(src, k) / 100000)
  withXfrm(c.ctx, xf, () => {
    c.ctx.drawImage(img, img.width * l, img.height * t, img.width * (1 - l - r), img.height * (1 - t - b), 0, 0, xf.w, xf.h)
  })
}

/** Children of a group / canvas in document order. */
async function drawChildren(c: Ctx, parent: El) {
  for (const ch of kids(parent)) {
    if (ch.nodeName === 'wps:wsp') await drawShape(c, ch)
    else if (ch.nodeName === 'pic:pic') await drawPicture(c, ch)
    else if (ch.nodeName === 'wpg:grpSp' || ch.nodeName === 'wpg:wgp') await drawGroup(c, ch)
    else if (ch.nodeName === 'mc:AlternateContent') {
      const choice = kid(ch, 'mc:Choice')
      if (choice) await drawChildren(c, choice)
    }
  }
}

async function drawGroup(c: Ctx, g: El) {
  const x = kid(kid(g, 'wpg:grpSpPr'), 'a:xfrm')
  const xf = readXfrm(x)
  const chOff = kid(x, 'a:chOff')
  const chExt = kid(x, 'a:chExt')
  const ctx = c.ctx
  ctx.save()
  if (xf) {
    const sx = num(chExt, 'cx') ? xf.w / num(chExt, 'cx') : 1
    const sy = num(chExt, 'cy') ? xf.h / num(chExt, 'cy') : 1
    ctx.translate(xf.x + xf.w / 2, xf.y + xf.h / 2)
    if (xf.rot) ctx.rotate(xf.rot)
    ctx.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1)
    ctx.translate(-xf.w / 2, -xf.h / 2)
    ctx.scale(sx, sy)
    ctx.translate(-num(chOff, 'x'), -num(chOff, 'y'))
  }
  await drawChildren(c, g)
  ctx.restore()
}

// ------------------------------------------------------------ document pass

interface DrawingItem {
  node: El // w:drawing
  replace: El // node to remove (w:drawing or its mc:AlternateContent)
  graphic: El // a:graphicData
  uri: string
  cx: number
  cy: number
  anchored: boolean
  x: number // position for anchored items (EMU, relative to their frame)
  y: number
  frame: string // relativeFrom H|V
  alt: string
}

function drawingItem(d: El): DrawingItem | null {
  const holder = kid(d, 'wp:anchor') ?? kid(d, 'wp:inline')
  const graphic = desc(holder, 'a:graphicData')
  if (!holder || !graphic) return null
  const ext = kid(holder, 'wp:extent')
  const alt = kid(holder, 'wp:docPr')
  const choice = ancestor(d, 'mc:Choice')
  const ac = choice ? ancestor(choice, 'mc:AlternateContent') : null
  const pos = (name: string) => {
    // Word 2010+ may wrap the position in mc:AlternateContent (percent offsets
    // in Choice); the Fallback has absolute EMU offsets.
    const p =
      kid(holder, name) ??
      kids(holder, 'mc:AlternateContent').map((ac) => kid(kid(ac, 'mc:Fallback'), name)).find(Boolean) ??
      null
    return { off: Number(desc(p, 'wp:posOffset')?.textContent ?? 0), from: p?.getAttribute('relativeFrom') ?? '' }
  }
  const h = pos('wp:positionH')
  const v = pos('wp:positionV')
  return {
    node: d, replace: ac ?? d, graphic, uri: graphic.getAttribute('uri') ?? '',
    cx: num(ext, 'cx'), cy: num(ext, 'cy'), anchored: holder.nodeName === 'wp:anchor',
    x: h.off, y: v.off, frame: `${h.from}|${v.from}`,
    alt: alt?.getAttribute('descr') || alt?.getAttribute('title') || '',
  }
}

/** A lone wps shape that is really a text container (content box, not part of a sketch). */
function isContentTextbox(item: DrawingItem): boolean {
  if (item.uri !== URI.shape) return false
  const sp = kid(item.graphic, 'wps:wsp')
  const prst = desc(sp, 'a:prstGeom')?.getAttribute('prst') ?? 'rect'
  if (!/^(rect|roundRect|flowChartProcess|flowChartAlternateProcess|snip|foldedCorner|plaque)/.test(prst)) return false
  return textOf(desc(sp, 'w:txbxContent')).trim().length >= CONTENT_TEXTBOX_CHARS
}

/** Text-less rectangles only (page bars, frames): decoration, not worth a picture. */
function isDecoration(items: DrawingItem[]): boolean {
  return items.every((i) => {
    if (i.uri === URI.picture || descAll(i.graphic, 'pic:pic').length) return false
    return descAll(i.graphic, 'wps:wsp').every((sp) => {
      const prst = desc(sp, 'a:prstGeom')?.getAttribute('prst') ?? (desc(sp, 'a:custGeom') ? 'custom' : 'rect')
      return /^(rect|roundRect|flowChartProcess|frame)$/.test(prst) && !textOf(desc(sp, 'w:txbxContent')).trim()
    })
  })
}

const overlaps = (a: DrawingItem, b: DrawingItem) =>
  a.x < b.x + b.cx && b.x < a.x + a.cx && a.y < b.y + b.cy && b.y < a.y + a.cy

async function renderItems(items: DrawingItem[], theme: Theme, images: Map<string, Buffer>): Promise<{ png: Buffer; cx: number; cy: number } | null> {
  const minX = Math.min(...items.map((i) => (i.anchored ? i.x : 0)))
  const minY = Math.min(...items.map((i) => (i.anchored ? i.y : 0)))
  const cx = Math.max(...items.map((i) => (i.anchored ? i.x : 0) + i.cx)) - minX
  const cy = Math.max(...items.map((i) => (i.anchored ? i.y : 0) + i.cy)) - minY
  if (cx <= 0 || cy <= 0) return null
  const k = Math.min(SCALE / EMU_PER_PX, MAX_SIDE / cx, MAX_SIDE / cy)
  // Small margin so strokes and arrow heads at the edge aren't clipped.
  const pad = 25400
  const canvas = createCanvas(Math.ceil((cx + 2 * pad) * k), Math.ceil((cy + 2 * pad) * k))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(k, k)
  ctx.translate(pad, pad)
  const c: Ctx = { ctx, theme, images, k }
  for (const it of items) {
    ctx.save()
    if (it.anchored) ctx.translate(it.x - minX, it.y - minY)
    const g = it.graphic
    if (it.uri === URI.group) await drawGroup(c, kid(g, 'wpg:wgp') as El)
    else if (it.uri === URI.canvas) await drawChildren(c, kid(g, 'wpc:wpc') as El)
    else if (it.uri === URI.shape) {
      // A lone shape's xfrm is usually 0,0 + its extent; draw as-is.
      await drawShape(c, kid(g, 'wps:wsp') as El)
    } else if (it.uri === URI.picture) await drawPicture(c, kid(g, 'pic:pic') as El)
    ctx.restore()
  }
  await Promise.all(pendingDraws)
  pendingDraws = []
  return { png: canvas.toBuffer('image/png'), cx: cx + 2 * pad, cy: cy + 2 * pad }
}

function inlinePicture(rid: string, cx: number, cy: number, n: number, alt: string): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!)
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="${NS.wp}">` +
    `<wp:extent cx="${Math.round(cx)}" cy="${Math.round(cy)}"/><wp:docPr id="${90000 + n}" name="Eduskript drawing ${n}" descr="${esc(alt)}"/>` +
    `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${URI.picture}"><pic:pic xmlns:pic="${NS.pic}">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="drawing-${n}.png" descr="${esc(alt)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}" xmlns:r="${NS.r}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  )
}

/**
 * Render every shape drawing in word/document.xml and replace it with a
 * picture. Mutates `zip` (new media, rels, content type). Returns how many
 * drawings were rendered.
 */
export async function renderDrawings(zip: JSZip): Promise<number> {
  const docXml = await zip.file('word/document.xml')?.async('string')
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  if (!docXml || !relsXml || !/<wp[sgc]:|wordprocessingGroup|wordprocessingCanvas|wordprocessingShape/.test(docXml)) return 0
  registerFonts()
  const theme = readTheme(await zip.file('word/theme/theme1.xml')?.async('string'))

  const images = new Map<string, Buffer>()
  for (const r of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = r[0].match(/Id="([^"]+)"/)?.[1]
    const target = r[0].match(/Target="([^"]+)"/)?.[1]
    if (!id || !target || !/\/image"/.test(r[0]) || /TargetMode="External"/.test(r[0])) continue
    const file = zip.file(`word/${target.replace(/^\/?word\//, '').replace(/^\.\//, '')}`)
    if (!file) continue
    let data: Buffer = Buffer.from(await file.async('uint8array'))
    const ext = target.split('.').pop()?.toLowerCase()
    if (ext === 'emf') data = (await renderEmfToPng(data)) ?? data
    else if (ext === 'wmf') {
      // Left as WMF: text-box formula objects render it themselves; pictures need PNG.
      const png = renderWmfToPng(data)
      if (png) images.set(`${id}#png`, png)
    }
    images.set(id, data)
  }
  // Pictures inside drawings need a decodable format: WMF ids point at their PNG.
  for (const key of [...images.keys()]) if (key.endsWith('#png')) images.set(key.slice(0, -4), images.get(key)!)

  const doc = new DOMParser().parseFromString(docXml, 'text/xml')
  const drawings = (Array.from(doc.getElementsByTagName('w:drawing')) as El[])
    .filter((d) => !ancestor(d, 'mc:Fallback') && !ancestor(d, 'w:txbxContent'))
    .map(drawingItem)
    .filter((i): i is DrawingItem => !!i)

  // Jobs: groups/canvases alone (inline) or clustered with the loose shapes
  // anchored in the same paragraph.
  const byParagraph = new Map<El, DrawingItem[]>()
  const jobs: DrawingItem[][] = []
  for (const it of drawings) {
    if (it.uri !== URI.group && it.uri !== URI.canvas && it.uri !== URI.shape && it.uri !== URI.picture) continue
    if (!it.anchored) {
      if (it.uri === URI.group || it.uri === URI.canvas || (it.uri === URI.shape && !isContentTextbox(it))) jobs.push([it])
      continue
    }
    const p = ancestor(it.node, 'w:p')
    if (!p) continue
    const list = byParagraph.get(p) ?? []
    list.push(it)
    byParagraph.set(p, list)
  }
  for (const list of byParagraph.values()) {
    // Split by positioning frame; within a frame, all non-content items form one drawing.
    const frames = new Map<string, DrawingItem[]>()
    for (const it of list) frames.set(it.frame, [...(frames.get(it.frame) ?? []), it])
    for (const items of frames.values()) {
      const shapes = items.filter((i) => i.uri !== URI.picture)
      if (!shapes.length) continue // only pictures: leave to pandoc
      const drawn = items.filter((i) => !isContentTextbox(i) || items.some((o) => o !== i && overlaps(i, o) && !isContentTextbox(o)))
      if (!drawn.some((i) => i.uri !== URI.picture)) continue
      jobs.push(drawn)
    }
  }
  const kept = jobs.filter((j) => !isDecoration(j))
  if (!kept.length) return 0

  let rels = relsXml
  let n = 0
  const serializer = new XMLSerializer()
  for (const job of kept) {
    if (process.env.SCRIPT_IMPORT_DEBUG) {
      console.log(`[drawing ${n + 1}]`, job.map((j) => `${j.uri.split('/').pop()} ${j.anchored ? 'anchor' : 'inline'} ${j.cx}x${j.cy} @${j.x},${j.y} ${j.frame}`).join(' | '))
    }
    let out: Awaited<ReturnType<typeof renderItems>> = null
    try {
      out = await renderItems(job, theme, images)
    } catch (err) {
      console.warn('[script-import] drawing render failed:', err)
    }
    if (!out) continue
    n++
    const rid = `rIdEduskriptDrawing${n}`
    zip.file(`word/media/eduskript-drawing-${n}.png`, out.png)
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/eduskript-drawing-${n}.png"/></Relationships>`
    )
    const alt = job.map((j) => j.alt).find(Boolean) ?? ''
    const frag = new DOMParser().parseFromString(
      `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r>${inlinePicture(rid, out.cx, out.cy, n, alt)}</w:r></w:p>`,
      'text/xml'
    ).documentElement as unknown as El
    const first = job[0]
    if (first.anchored) {
      // Floating drawing: own paragraph after the anchor paragraph.
      const p = ancestor(first.node, 'w:p')
      p?.parentNode?.insertBefore(doc.importNode(frag, true), p.nextSibling)
      for (const it of job) it.replace.parentNode?.removeChild(it.replace)
    } else {
      const run = kid(frag, 'w:r')!
      const drawing = kid(run, 'w:drawing')!
      first.replace.parentNode?.replaceChild(doc.importNode(drawing, true), first.replace)
    }
  }
  if (!n) return 0
  zip.file('word/document.xml', serializer.serializeToString(doc))
  zip.file('word/_rels/document.xml.rels', rels)
  const types = (await zip.file('[Content_Types].xml')?.async('string')) ?? ''
  if (types && !/Extension="png"/i.test(types)) {
    zip.file('[Content_Types].xml', types.replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>'))
  }
  return n
}
