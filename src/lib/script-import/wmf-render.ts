/**
 * Minimal WMF → PNG renderer for Word's legacy formula objects.
 *
 * Why: formulas made with the old Equation Editor 3.0 or MathType are OLE
 * objects; pandoc can't convert them to TeX and only extracts their WMF
 * preview picture, which browsers can't display. We rasterize that picture
 * so it (a) shows up in the preview as an image and (b) can be transcribed to
 * LaTeX by the vision model in cleanup.ts.
 *
 * Existing JS libraries didn't work on these files (checked 2026-09-23):
 * rtf.js/WMFJS placed every text run at 0,0; SheetJS `wmf` rejects the
 * placeable header and lacks MoveTo/LineTo. Equation Editor/MathType WMFs use
 * a small record subset, handled here: window org/ext, pens, brushes, fonts,
 * select/delete object, text align/color, ExtTextOut/TextOut (with per-glyph
 * dx), MoveTo/LineTo, Polygon/Polyline, Rectangle. Everything else (bitmaps,
 * clipping, regions, arcs) is ignored — fine for formulas, NOT a general WMF
 * renderer (drawings from other tools will render incompletely or blank).
 *
 * Fonts: KaTeX's TTFs from node_modules (Times-like Main + Math italic);
 * "Symbol"-font text is mapped to Unicode via SYMBOL_MAP. Glyph metrics differ
 * from the originals, so spacing is approximate. Output is scaled 2x for
 * legibility. EMF: see renderEmfToPng below (embedded bitmaps only).
 */
import path from 'path'
import { existsSync } from 'fs'
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas'

const SCALE = 2
const MAX_SIDE = 4000 // px; guards against bogus headers allocating huge canvases

let fontsRegistered = false
export function registerFonts() {
  if (fontsRegistered) return
  fontsRegistered = true
  // cwd is the project root in dev and .next/standalone in production (its
  // server.js chdirs); next.config.ts outputFileTracingIncludes copies the fonts there.
  const dir = path.join(process.cwd(), 'node_modules/katex/dist/fonts')
  if (!existsSync(path.join(dir, 'KaTeX_Main-Regular.ttf'))) {
    console.warn(`[script-import] KaTeX fonts missing in ${dir}; formula pictures will have no text`)
  }
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_Main-Regular.ttf'), 'WmfSerif')
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_Main-Italic.ttf'), 'WmfSerifItalic')
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_Main-Bold.ttf'), 'WmfSerifBold')
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_Main-BoldItalic.ttf'), 'WmfSerifBoldItalic')
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_Size1-Regular.ttf'), 'WmfSize1')
  // Used by drawing-render.ts: Word's default sans fonts (Calibri, Arial) and OMML variables.
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_SansSerif-Regular.ttf'), 'WmfSans')
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_SansSerif-Bold.ttf'), 'WmfSansBold')
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_SansSerif-Italic.ttf'), 'WmfSansItalic')
  GlobalFonts.registerFromPath(path.join(dir, 'KaTeX_Math-Italic.ttf'), 'WmfMathItalic')
  // DejaVu (npm dejavu-fonts-ttf, Bitstream Vera licence): full Latin/Greek/
  // symbol coverage, used for text in drawings and as per-glyph fallback.
  const dv = path.join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf')
  for (const [file, alias] of [
    ['DejaVuSans.ttf', 'DVSans'], ['DejaVuSans-Bold.ttf', 'DVSansBold'], ['DejaVuSans-Oblique.ttf', 'DVSansItalic'],
    ['DejaVuSans-BoldOblique.ttf', 'DVSansBoldItalic'], ['DejaVuSerif.ttf', 'DVSerif'], ['DejaVuSerif-Bold.ttf', 'DVSerifBold'],
    ['DejaVuSerif-Italic.ttf', 'DVSerifItalic'], ['DejaVuSerif-BoldItalic.ttf', 'DVSerifBoldItalic'],
    // Condensed ≈ Calibri's width (Word's default sans), so labels fit their boxes.
    ['DejaVuSansCondensed.ttf', 'DVSansCond'], ['DejaVuSansCondensed-Bold.ttf', 'DVSansCondBold'],
    ['DejaVuSansCondensed-Oblique.ttf', 'DVSansCondItalic'], ['DejaVuSansCondensed-BoldOblique.ttf', 'DVSansCondBoldItalic'],
  ]) {
    GlobalFonts.registerFromPath(path.join(dv, file), alias)
  }
}

// Adobe Symbol encoding → Unicode, for the characters formula editors use.
export const SYMBOL_MAP: Record<number, string> = (() => {
  const m: Record<number, string> = {}
  const greekLower = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'
  const greekUpper = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'
  for (let i = 0; i < 26; i++) {
    m[0x61 + i] = greekLower[i]
    m[0x41 + i] = greekUpper[i]
  }
  Object.assign(m, {
    0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅', 0x5c: '∴', 0x5e: '⊥', 0x60: '‾',
    0x7e: '∼', 0xa2: '′', 0xa3: '≤', 0xa5: '∞', 0xa6: 'ƒ', 0xab: '↔', 0xac: '←', 0xad: '↑', 0xae: '→',
    0xaf: '↓', 0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥', 0xb4: '×', 0xb5: '∝', 0xb6: '∂', 0xb7: '•',
    0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…', 0xbd: '|', 0xbe: '—', 0xc4: '⊗', 0xc5: '⊕',
    0xc6: '∅', 0xc7: '∩', 0xc8: '∪', 0xc9: '⊃', 0xca: '⊇', 0xcb: '⊄', 0xcc: '⊂', 0xcd: '⊆', 0xce: '∈',
    0xcf: '∉', 0xd0: '∠', 0xd1: '∇', 0xd5: '∏', 0xd6: '√', 0xd7: '⋅', 0xd8: '¬', 0xd9: '∧', 0xda: '∨',
    0xdb: '⇔', 0xdc: '⇐', 0xdd: '⇑', 0xde: '⇒', 0xdf: '⇓', 0xe1: '〈', 0xe5: '∑', 0xe6: '⎛', 0xe7: '|',
    0xe8: '⎝', 0xe9: '⎡', 0xea: '⎢', 0xeb: '⎣', 0xec: '⎧', 0xed: '⎨', 0xee: '⎩', 0xef: '⎪', 0xf1: '〉',
    0xf2: '∫', 0xf3: '⌠', 0xf4: '⎮', 0xf5: '⌡', 0xf6: '⎞', 0xf7: '⎟', 0xf8: '⎠', 0xf9: '⎤', 0xfa: '⎥',
    0xfb: '⎦', 0xfc: '⎫', 0xfd: '⎬', 0xfe: '⎭',
  })
  return m
})()

// MathType's "MT Extra" font: only the few glyphs common in school formulas.
const MT_EXTRA_MAP: Record<number, string> = { 0x4c: '…', 0x4b: '⋯', 0x3c: '⃗', 0x72: '→', 0x71: 'ℏ', 0x6c: 'ℓ', 0x3d: '‾' }

const cp1252 = new TextDecoder('windows-1252')

// KaTeX_Main has no precomposed accented letters (ä, é, …) but has the bare
// accents; draw base + accent. Covers German/French school text.
export const ACCENTS: Record<string, [string, string]> = (() => {
  const m: Record<string, [string, string]> = {}
  const add = (accent: string, pairs: string) => {
    for (let i = 0; i < pairs.length; i += 2) m[pairs[i]] = [pairs[i + 1], accent]
  }
  add('\u00a8', 'äaöoüuëeïiÿyÄAÖOÜUËEÏI')
  add('\u02ca', 'áaéeíióoúuÁAÉEÍIÓOÚU')
  add('\u02cb', 'àaèeìiòoùuÀAÈEÌIÒOÙU')
  add('\u02c6', 'âaêeîiôoûuÂAÊEÎIÔOÛU')
  add('\u02dc', 'ñnõoãaÑNÕOÃA')
  add('\u02c7', 'čcšsžzřrěeČCŠSŽZŘRĚE')
  m['ç'] = ['c', '\u00b8']
  m['µ'] = ['μ', '']
  return m
})()

/** Draws chars left-aligned from x (canvas px); dxPx = per-char advances or null (measured). Returns end x. */
/** compose = draw ä as a + ¨ (for KaTeX fonts, which lack precomposed letters); off when a DejaVu font is primary. */
export function fillRun(ctx: SKRSContext2D, chars: string[], x: number, y: number, dxPx: number[] | null, sizePx: number, compose = true): number {
  const align = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((ch, k) => {
    const composed = compose ? ACCENTS[ch] : undefined
    const base = composed ? composed[0] : ch
    ctx.fillText(base, x, y)
    const w = ctx.measureText(base).width
    if (composed?.[1]) {
      const aw = ctx.measureText(composed[1]).width
      const lift = base === base.toUpperCase() && base !== 'ç' ? sizePx * 0.22 : 0
      ctx.fillText(composed[1], x + (w - aw) / 2, y - lift)
    }
    x += dxPx ? dxPx[k] ?? w : w
  })
  ctx.textAlign = align
  return x
}

type Obj =
  | { kind: 'pen'; color: string; width: number; none: boolean }
  | { kind: 'brush'; color: string; none: boolean }
  | { kind: 'font'; height: number; weight: number; italic: boolean; face: string }
  | { kind: 'other' }

export const colorref = (b: Buffer, o: number) => `rgb(${b[o]},${b[o + 1]},${b[o + 2]})`
/** Hatched brushes (thin lines on white) approximated by 25 % of their colour. */
const hatchTint = (b: Buffer, o: number) => `rgb(${[0, 1, 2].map((i) => Math.round(b[o + i] * 0.25 + 255 * 0.75)).join(',')})`

/** Pixel size of a WMF from its placeable header (96 dpi), null if absent. */
export function wmfSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x9ac6cdd7) return null
  const inch = buf.readUInt16LE(14) || 1440
  const w = ((buf.readInt16LE(10) - buf.readInt16LE(6)) / inch) * 96
  const h = ((buf.readInt16LE(12) - buf.readInt16LE(8)) / inch) * 96
  return w > 0 && h > 0 ? { w, h } : null
}

/** Render a (placeable) WMF to PNG. Returns null if the file isn't a WMF we can read. */
export function renderWmfToPng(buf: Buffer): Buffer | null {
  try {
    return render(buf)
  } catch (err) {
    console.warn('[script-import] WMF render failed:', err)
    return null
  }
}

function render(buf: Buffer): Buffer | null {
  const size = wmfSize(buf)
  if (!size) return null
  registerFonts()

  const W = Math.min(Math.ceil(size.w * SCALE), MAX_SIDE)
  const H = Math.min(Math.ceil(size.h * SCALE), MAX_SIDE)
  const canvas = createCanvas(Math.max(W, 1), Math.max(H, 1))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)

  // Logical → device mapping. Defaults to the placeable bbox until the file
  // sets its own window.
  let orgX = buf.readInt16LE(6)
  let orgY = buf.readInt16LE(8)
  let extX = buf.readInt16LE(10) - orgX
  let extY = buf.readInt16LE(12) - orgY
  const px = (x: number) => ((x - orgX) * W) / (extX || 1)
  const py = (y: number) => ((y - orgY) * H) / (extY || 1)
  const sy = (d: number) => Math.abs((d * H) / (extY || 1))

  const objects: (Obj | null)[] = []
  const add = (o: Obj) => {
    const i = objects.indexOf(null)
    if (i >= 0) objects[i] = o
    else objects.push(o)
  }
  let pen: Obj = { kind: 'pen', color: '#000', width: 1, none: false }
  let brush: Obj = { kind: 'brush', color: '#fff', none: true }
  let font: Obj = { kind: 'font', height: -12, weight: 400, italic: false, face: 'Times New Roman' }
  let textColor = '#000'
  let align = 0
  let cur = { x: 0, y: 0 }

  // Standard header follows the 22-byte placeable header; its size is in words.
  let o = 22 + buf.readUInt16LE(22 + 2) * 2
  for (let guard = 0; o + 6 <= buf.length && guard < 200_000; guard++) {
    const words = buf.readUInt32LE(o)
    const fn = buf.readUInt16LE(o + 4)
    if (fn === 0 || words < 3) break
    const p = o + 6 // params
    const end = Math.min(o + words * 2, buf.length)
    const i16 = (k: number) => (p + k * 2 + 2 <= end ? buf.readInt16LE(p + k * 2) : 0)

    switch (fn) {
      case 0x20b: // SETWINDOWORG (y, x)
        orgY = i16(0)
        orgX = i16(1)
        break
      case 0x20c: // SETWINDOWEXT (y, x)
        extY = i16(0)
        extX = i16(1)
        break
      case 0x2fa: // CREATEPENINDIRECT: style, width.x, width.y, color
        add({ kind: 'pen', none: (i16(0) & 0xf) === 5, width: Math.max(i16(1), 1), color: colorref(buf, p + 6) })
        break
      case 0x2fc: // CREATEBRUSHINDIRECT: style, color, hatch — hatches drawn as a light tint
        add({ kind: 'brush', none: i16(0) === 1, color: i16(0) === 2 ? hatchTint(buf, p + 2) : colorref(buf, p + 2) })
        break
      case 0x2fb: {
        // CREATEFONTINDIRECT
        const faceBytes = buf.subarray(p + 18, Math.min(p + 18 + 32, end))
        const nul = faceBytes.indexOf(0)
        add({
          kind: 'font',
          height: i16(0),
          weight: i16(4),
          italic: buf[p + 10] !== 0,
          face: cp1252.decode(nul >= 0 ? faceBytes.subarray(0, nul) : faceBytes),
        })
        break
      }
      case 0x12d: {
        // SELECTOBJECT
        const obj = objects[i16(0) & 0xffff]
        if (obj?.kind === 'pen') pen = obj
        else if (obj?.kind === 'brush') brush = obj
        else if (obj?.kind === 'font') font = obj
        break
      }
      case 0x1f0: // DELETEOBJECT
        if (objects[i16(0)] !== undefined) objects[i16(0)] = null
        break
      case 0x2f0: // CREATEPALETTE and other objects occupy a slot too
      case 0xf7:
      case 0x6ff:
        add({ kind: 'other' })
        break
      case 0x12e: // SETTEXTALIGN
        align = i16(0) & 0xffff
        break
      case 0x209: // SETTEXTCOLOR
        textColor = colorref(buf, p)
        break
      case 0x214: // MOVETO (y, x)
        cur = { x: i16(1), y: i16(0) }
        break
      case 0x213: {
        // LINETO (y, x)
        const to = { x: i16(1), y: i16(0) }
        if (pen.kind === 'pen' && !pen.none) stroke(ctx, pen, [cur, to], px, py, sy)
        cur = to
        break
      }
      case 0x324: // POLYGON
      case 0x325: {
        // POLYLINE
        const n = i16(0)
        const pts = Array.from({ length: n }, (_, k) => ({ x: i16(1 + k * 2), y: i16(2 + k * 2) }))
        if (fn === 0x324 && brush.kind === 'brush' && !brush.none && pts.length > 2) {
          ctx.fillStyle = brush.color
          ctx.beginPath()
          pts.forEach((q, k) => (k ? ctx.lineTo(px(q.x), py(q.y)) : ctx.moveTo(px(q.x), py(q.y))))
          ctx.closePath()
          ctx.fill()
        }
        if (pen.kind === 'pen' && !pen.none) stroke(ctx, pen, fn === 0x324 ? [...pts, pts[0]] : pts, px, py, sy)
        break
      }
      case 0x41b: {
        // RECTANGLE (bottom, right, top, left)
        const [b, r, t, l] = [i16(0), i16(1), i16(2), i16(3)]
        if (brush.kind === 'brush' && !brush.none) {
          ctx.fillStyle = brush.color
          ctx.fillRect(px(l), py(t), px(r) - px(l), py(b) - py(t))
        }
        if (pen.kind === 'pen' && !pen.none) stroke(ctx, pen, [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }, { x: l, y: t }], px, py, sy)
        break
      }
      case 0xa32: {
        // EXTTEXTOUT: y, x, count, options, [rect], string, [dx]
        const y = i16(0)
        const x = i16(1)
        const count = i16(2)
        const opts = i16(3)
        let s = p + 8 + (opts & 0x6 ? 8 : 0)
        const bytes = buf.subarray(s, Math.min(s + count, end))
        s += count + (count % 2)
        const dx = s + count * 2 <= end ? Array.from({ length: count }, (_, k) => buf.readInt16LE(s + k * 2)) : null
        const at = align & 1 ? cur : { x, y }
        const advance = drawText(ctx, bytes, at, dx, font, textColor, align, px, py, sy)
        if (align & 1) cur = { x: cur.x + advance, y: cur.y }
        break
      }
      case 0x521: {
        // TEXTOUT: count, string, y, x
        const count = i16(0)
        const bytes = buf.subarray(p + 2, Math.min(p + 2 + count, end))
        const q = p + 2 + count + (count % 2)
        if (q + 4 <= end) drawText(ctx, bytes, { x: buf.readInt16LE(q + 2), y: buf.readInt16LE(q) }, null, font, textColor, align, px, py, sy)
        break
      }
      default:
        break
    }
    o += words * 2
  }
  return canvas.toBuffer('image/png')
}

function stroke(
  ctx: SKRSContext2D,
  pen: Extract<Obj, { kind: 'pen' }>,
  pts: { x: number; y: number }[],
  px: (x: number) => number,
  py: (y: number) => number,
  sy: (d: number) => number
) {
  ctx.strokeStyle = pen.color
  ctx.lineWidth = Math.max(sy(pen.width), 1)
  ctx.beginPath()
  pts.forEach((q, k) => (k ? ctx.lineTo(px(q.x), py(q.y)) : ctx.moveTo(px(q.x), py(q.y))))
  ctx.stroke()
}

/** Draws one text run; returns its advance in logical units (sum of dx, or measured). */
function drawText(
  ctx: SKRSContext2D,
  bytes: Buffer,
  at: { x: number; y: number },
  dx: number[] | null,
  font: Obj,
  color: string,
  align: number,
  px: (x: number) => number,
  py: (y: number) => number,
  sy: (d: number) => number
): number {
  if (font.kind !== 'font' || bytes.length === 0) return 0
  const face = font.face.toLowerCase()
  const chars = face === 'symbol'
    ? Array.from(bytes, (b) => SYMBOL_MAP[b] ?? String.fromCharCode(b))
    : face.startsWith('mt extra')
      ? Array.from(bytes, (b) => MT_EXTRA_MAP[b] ?? '')
      : Array.from(cp1252.decode(bytes))
  // Negative height = em size; positive = cell height (≈ 1.2 em).
  const sizePx = Math.max(font.height < 0 ? sy(-font.height) : sy(font.height) / 1.2, 1)
  const family = font.weight >= 600
    ? font.italic ? 'WmfSerifBoldItalic' : 'WmfSerifBold'
    : font.italic ? 'WmfSerifItalic' : 'WmfSerif'
  ctx.font = `${sizePx.toFixed(2)}px ${family}`
  ctx.fillStyle = color
  // TA_BASELINE (24) / TA_BOTTOM (8) / default TA_TOP.
  ctx.textBaseline = (align & 24) === 24 ? 'alphabetic' : align & 8 ? 'bottom' : 'top'
  const vAlign = align & 6 // TA_CENTER=6, TA_RIGHT=2
  ctx.textAlign = vAlign === 6 ? 'center' : vAlign === 2 ? 'right' : 'left'

  if (dx && vAlign === 0) {
    fillRun(ctx, chars, px(at.x), py(at.y), dx.map((d) => px(d) - px(0)), sizePx)
    return dx.reduce((a, b) => a + b, 0)
  }
  const width = chars.reduce((w, ch) => w + ctx.measureText(ACCENTS[ch]?.[0] ?? ch).width, 0)
  const x0 = px(at.x) - (vAlign === 6 ? width / 2 : vAlign === 2 ? width : 0)
  fillRun(ctx, chars, x0, py(at.y), null, sizePx)
  return dx ? dx.reduce((a, b) => a + b, 0) : 0
}

/**
 * EMF → PNG. Same approach as the WMF renderer: a record subset that covers
 * what the 2026-09 corpus contains — ChemDraw structure formulas and Equation
 * Editor previews (lines, polygons/beziers, paths, UTF-16 text) and pasted
 * pictures wrapped in EMF (EMR_STRETCHDIBITS). Handles window/viewport
 * mapping, SaveDC/RestoreDC, stock objects. Ignores world transforms,
 * clipping, ROPs, hatches, EMF+ records (GDI fallback records are drawn) and
 * BitBlt pattern fills. Returns null if nothing drawable was found.
 */
export async function renderEmfToPng(buf: Buffer): Promise<Buffer | null> {
  try {
    return renderEmf(buf)
  } catch (err) {
    console.warn('[script-import] EMF render failed:', err)
    return null
  }
}

interface EmfState {
  winOrg: [number, number]
  winExt: [number, number]
  vpOrg: [number, number]
  vpExt: [number, number]
  mapMode: number
  pen: Extract<Obj, { kind: 'pen' }>
  brush: Extract<Obj, { kind: 'brush' }>
  font: Extract<Obj, { kind: 'font' }>
  textColor: string
  align: number
  cur: [number, number]
}

const STOCK: Record<number, Obj> = {
  0: { kind: 'brush', color: '#fff', none: false },
  1: { kind: 'brush', color: '#c0c0c0', none: false },
  2: { kind: 'brush', color: '#808080', none: false },
  3: { kind: 'brush', color: '#404040', none: false },
  4: { kind: 'brush', color: '#000', none: false },
  5: { kind: 'brush', color: '#fff', none: true },
  6: { kind: 'pen', color: '#fff', width: 1, none: false },
  7: { kind: 'pen', color: '#000', width: 1, none: false },
  8: { kind: 'pen', color: '#000', width: 1, none: true },
}

function renderEmf(buf: Buffer): Buffer | null {
  if (buf.length < 88 || buf.readUInt32LE(0) !== 1 || buf.readUInt32LE(40) !== 0x464d4520 /* " EMF" */) return null
  registerFonts()
  const bl = buf.readInt32LE(8)
  const bt = buf.readInt32LE(12)
  const bw = buf.readInt32LE(16) - bl + 1
  const bh = buf.readInt32LE(20) - bt + 1
  if (bw <= 1 || bh <= 1) return null
  const scale = Math.min(SCALE, MAX_SIDE / bw, MAX_SIDE / bh)
  const canvas = createCanvas(Math.ceil(bw * scale), Math.ceil(bh * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let st: EmfState = {
    winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1], mapMode: 1,
    pen: STOCK[7] as EmfState['pen'], brush: STOCK[0] as EmfState['brush'],
    font: { kind: 'font', height: -12, weight: 400, italic: false, face: 'Arial' },
    textColor: '#000', align: 0, cur: [0, 0],
  }
  const saved: EmfState[] = []
  const objects = new Map<number, Obj>()
  const mapped = () => st.mapMode === 7 || st.mapMode === 8
  // logical → canvas
  const X = (x: number) => ((mapped() ? ((x - st.winOrg[0]) * st.vpExt[0]) / (st.winExt[0] || 1) + st.vpOrg[0] : x) - bl) * scale
  const Y = (y: number) => ((mapped() ? ((y - st.winOrg[1]) * st.vpExt[1]) / (st.winExt[1] || 1) + st.vpOrg[1] : y) - bt) * scale
  const SY = (d: number) => Math.abs((mapped() ? (d * st.vpExt[1]) / (st.winExt[1] || 1) : d) * scale)

  let inPath = false
  let drew = false
  const finish = (fill: boolean, stroke: boolean) => {
    if (fill && !st.brush.none) {
      ctx.fillStyle = st.brush.color
      ctx.fill()
      drew = true
    }
    if (stroke && !st.pen.none) {
      ctx.strokeStyle = st.pen.color
      ctx.lineWidth = Math.max(SY(st.pen.width), 1)
      ctx.stroke()
      drew = true
    }
  }
  const poly = (pts: [number, number][], close: boolean, fill: boolean, continueFromCur = false) => {
    if (!pts.length) return
    if (!inPath) ctx.beginPath()
    if (continueFromCur) ctx.moveTo(X(st.cur[0]), Y(st.cur[1]))
    pts.forEach(([x, y], k) => (k || continueFromCur ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))))
    if (close) ctx.closePath()
    if (!inPath) finish(fill, true)
  }
  const bezier = (pts: [number, number][], fromCur: boolean) => {
    if (!inPath) ctx.beginPath()
    let start = 0
    if (fromCur) ctx.moveTo(X(st.cur[0]), Y(st.cur[1]))
    else if (pts.length) {
      ctx.moveTo(X(pts[0][0]), Y(pts[0][1]))
      start = 1
    }
    for (let k = start; k + 2 < pts.length; k += 3) {
      const [a, b2, c] = [pts[k], pts[k + 1], pts[k + 2]]
      ctx.bezierCurveTo(X(a[0]), Y(a[1]), X(b2[0]), Y(b2[1]), X(c[0]), Y(c[1]))
    }
    if (pts.length) st.cur = pts[pts.length - 1]
    if (!inPath) finish(false, true)
  }
  const pts16 = (o: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, k) => [buf.readInt16LE(o + k * 4), buf.readInt16LE(o + k * 4 + 2)])
  const pts32 = (o: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, k) => [buf.readInt32LE(o + k * 8), buf.readInt32LE(o + k * 8 + 4)])

  for (let o = 0, guard = 0; o + 8 <= buf.length && guard < 500_000; guard++) {
    const type = buf.readUInt32LE(o)
    const size = buf.readUInt32LE(o + 4)
    if (size < 8 || o + size > buf.length) break
    const i32 = (k: number) => buf.readInt32LE(o + k)
    const u32 = (k: number) => buf.readUInt32LE(o + k)
    switch (type) {
      case 9: st.winExt = [i32(8), i32(12)]; break
      case 10: st.winOrg = [i32(8), i32(12)]; break
      case 11: st.vpExt = [i32(8), i32(12)]; break
      case 12: st.vpOrg = [i32(8), i32(12)]; break
      case 17: st.mapMode = u32(8); break
      case 22: st.align = u32(8); break
      case 24: st.textColor = colorref(buf, o + 8); break
      case 33: saved.push(structuredClone(st)); break
      case 34: {
        const n = i32(8)
        const idx = n < 0 ? saved.length + n : n
        if (idx >= 0 && idx < saved.length) {
          st = saved[idx]
          saved.length = idx
        }
        break
      }
      case 38: // CREATEPEN: ih, style, width.x, width.y, color
        objects.set(u32(8), { kind: 'pen', none: (u32(12) & 0xf) === 5, width: Math.max(i32(16), 1), color: colorref(buf, o + 24) })
        break
      case 95: // EXTCREATEPEN: ih, offBmi, cbBmi, offBits, cbBits, style, width, brushStyle, color
        objects.set(u32(8), { kind: 'pen', none: (u32(28) & 0xf) === 5, width: Math.max(i32(32), 1), color: colorref(buf, o + 40) })
        break
      case 39: // CREATEBRUSHINDIRECT: ih, style, color, hatch — hatches drawn as a light tint
        objects.set(u32(8), { kind: 'brush', none: u32(12) === 1, color: u32(12) === 2 ? hatchTint(buf, o + 16) : colorref(buf, o + 16) })
        break
      case 82: { // EXTCREATEFONTINDIRECTW: ih, LOGFONTW
        const face = buf.toString('utf16le', o + 40, Math.min(o + 104, o + size)).split('\0')[0]
        objects.set(u32(8), { kind: 'font', height: i32(12), weight: i32(28), italic: buf[o + 32] !== 0, face })
        break
      }
      case 37: { // SELECTOBJECT
        const ih = u32(8)
        const obj = ih & 0x80000000 ? STOCK[ih & 0x7fffffff] : objects.get(ih)
        if (obj?.kind === 'pen') st.pen = obj
        else if (obj?.kind === 'brush') st.brush = obj
        else if (obj?.kind === 'font') st.font = obj
        break
      }
      case 40: objects.delete(u32(8)); break
      case 27: st.cur = [i32(8), i32(12)]; break // MOVETOEX
      case 54: { // LINETO
        const to: [number, number] = [i32(8), i32(12)]
        if (inPath) ctx.lineTo(X(to[0]), Y(to[1]))
        else poly([st.cur, to], false, false)
        st.cur = to
        break
      }
      case 59: inPath = true; ctx.beginPath(); break
      case 60: inPath = false; break
      case 61: ctx.closePath(); break
      case 62: finish(true, false); break
      case 63: finish(true, true); break
      case 64: finish(false, true); break
      case 3: poly(pts32(o + 28, u32(24)), true, true); break // POLYGON
      case 4: poly(pts32(o + 28, u32(24)), false, false); break // POLYLINE
      case 86: poly(pts16(o + 28, u32(24)), true, true); break // POLYGON16
      case 87: poly(pts16(o + 28, u32(24)), false, false); break // POLYLINE16
      case 89: { const p = pts16(o + 28, u32(24)); poly(p, false, false, true); if (p.length) st.cur = p[p.length - 1]; break } // POLYLINETO16
      case 85: bezier(pts16(o + 28, u32(24)), false); break // POLYBEZIER16
      case 88: bezier(pts16(o + 28, u32(24)), true); break // POLYBEZIERTO16
      case 90: case 91: { // POLYPOLYLINE16 / POLYPOLYGON16
        const nPolys = u32(24)
        let q = o + 32 + nPolys * 4
        for (let k = 0; k < nPolys; k++) {
          const n = u32(32 + k * 4)
          poly(pts16(q, n), type === 91, type === 91)
          q += n * 4
        }
        break
      }
      case 43: case 42: { // RECTANGLE / ELLIPSE
        const [l, t, r, b] = [i32(8), i32(12), i32(16), i32(20)]
        if (!inPath) ctx.beginPath()
        if (type === 43) ctx.rect(X(l), Y(t), X(r) - X(l), Y(b) - Y(t))
        else ctx.ellipse((X(l) + X(r)) / 2, (Y(t) + Y(b)) / 2, Math.abs(X(r) - X(l)) / 2, Math.abs(Y(b) - Y(t)) / 2, 0, 0, Math.PI * 2)
        if (!inPath) finish(true, true)
        break
      }
      case 84: { // EXTTEXTOUTW → EMRTEXT at +36
        const n = u32(44)
        const off = u32(48)
        if (!n || o + off + n * 2 > o + size) break
        const text = buf.toString('utf16le', o + off, o + off + n * 2)
        const offDx = u32(72)
        const dx = offDx && o + offDx + n * 4 <= o + size ? Array.from({ length: n }, (_, k) => i32(offDx + k * 4)) : null
        const at = st.align & 1 ? st.cur : ([i32(36), i32(40)] as [number, number])
        const adv = drawTextUnicode(ctx, text, at, dx, st.font, st.textColor, st.align, X, Y, SY)
        if (st.align & 1) st.cur = [st.cur[0] + adv, st.cur[1]]
        drew = true
        break
      }
      case 81: { // STRETCHDIBITS: draw the bitmap into its destination rect
        const dib = decodeDib(buf, o + u32(48), o + u32(56), o + size)
        if (dib) {
          const img = ctx.createImageData(dib.w, dib.h)
          img.data.set(dib.rgba)
          const tmp = createCanvas(dib.w, dib.h)
          tmp.getContext('2d').putImageData(img, 0, 0)
          const [x, y, cw, ch] = [i32(24), i32(28), i32(72), i32(76)]
          ctx.drawImage(tmp, X(x), Y(y), X(x + cw) - X(x), Y(y + ch) - Y(y))
          drew = true
        }
        break
      }
      case 14: o = buf.length; continue // EOF
      default: break
    }
    o += size
  }
  return drew ? canvas.toBuffer('image/png') : null
}

/** Like drawText (WMF) but for already-decoded UTF-16 text; Symbol font is remapped from its PUA/ASCII codes. */
function drawTextUnicode(
  ctx: SKRSContext2D,
  text: string,
  at: [number, number],
  dx: number[] | null,
  font: Extract<Obj, { kind: 'font' }>,
  color: string,
  align: number,
  X: (x: number) => number,
  Y: (y: number) => number,
  SY: (d: number) => number
): number {
  const face = font.face.toLowerCase()
  const chars = Array.from(text, (ch) => {
    const code = ch.charCodeAt(0) & (face === 'symbol' ? 0xff : 0xffff)
    return face === 'symbol' ? SYMBOL_MAP[code] ?? String.fromCharCode(code) : ch
  })
  const sizePx = Math.max(font.height < 0 ? SY(-font.height) : SY(font.height) / 1.2, 1)
  const family = font.weight >= 600
    ? font.italic ? 'WmfSerifBoldItalic' : 'WmfSerifBold'
    : font.italic ? 'WmfSerifItalic' : 'WmfSerif'
  ctx.font = `${sizePx.toFixed(2)}px ${family}`
  ctx.fillStyle = color
  ctx.textBaseline = (align & 24) === 24 ? 'alphabetic' : align & 8 ? 'bottom' : 'top'
  const h = align & 6
  ctx.textAlign = h === 6 ? 'center' : h === 2 ? 'right' : 'left'
  if (dx && h === 0) {
    fillRun(ctx, chars, X(at[0]), Y(at[1]), dx.map((d) => X(d) - X(0)), sizePx)
    return dx.reduce((a, b) => a + b, 0)
  }
  const width = chars.reduce((w, ch) => w + ctx.measureText(ACCENTS[ch]?.[0] ?? ch).width, 0)
  const x0 = X(at[0]) - (h === 6 ? width / 2 : h === 2 ? width : 0)
  fillRun(ctx, chars, x0, Y(at[1]), null, sizePx)
  return dx ? dx.reduce((a, b) => a + b, 0) : 0
}

function decodeDib(buf: Buffer, h: number, bits: number, end: number) {
  const w = buf.readInt32LE(h + 4)
  const rawH = buf.readInt32LE(h + 8)
  const height = Math.abs(rawH)
  const bpp = buf.readUInt16LE(h + 14)
  const comp = buf.readUInt32LE(h + 16)
  const clrUsed = buf.readUInt32LE(h + 32)
  if (w <= 0 || height <= 0 || w * height > 25_000_000) return null
  if (!(comp === 0 || (comp === 3 && bpp === 32)) || ![1, 4, 8, 16, 24, 32].includes(bpp)) return null
  const palette: number[][] = []
  if (bpp <= 8) {
    const n = clrUsed || 1 << bpp
    const p = h + buf.readUInt32LE(h)
    for (let i = 0; i < n; i++) palette.push([buf[p + i * 4 + 2], buf[p + i * 4 + 1], buf[p + i * 4]])
  }
  const stride = ((w * bpp + 31) >> 5) * 4
  if (bits + stride * height > end) return null
  const rgba = Buffer.alloc(w * height * 4)
  for (let y = 0; y < height; y++) {
    const row = bits + (rawH > 0 ? height - 1 - y : y) * stride // bottom-up unless height < 0
    for (let x = 0; x < w; x++) {
      let r: number, g: number, b: number
      if (bpp === 16) {
        const v = buf.readUInt16LE(row + x * 2)
        ;[r, g, b] = [((v >> 10) & 31) * 8.226, ((v >> 5) & 31) * 8.226, (v & 31) * 8.226].map(Math.round)
      } else if (bpp === 24 || bpp === 32) {
        const q = row + x * (bpp / 8)
        ;[b, g, r] = [buf[q], buf[q + 1], buf[q + 2]]
      } else {
        const bit = x * bpp
        const byte = buf[row + (bit >> 3)]
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)
        ;[r, g, b] = palette[idx] ?? [0, 0, 0]
      }
      const d = (y * w + x) * 4
      rgba[d] = r
      rgba[d + 1] = g
      rgba[d + 2] = b
      rgba[d + 3] = 255
    }
  }
  return { w, h: height, rgba }
}
