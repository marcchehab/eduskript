/**
 * Post-processing of the SVG that node-tikzjax (dvi2svg, unoptimised) emits.
 *
 * 1. Text → paths. The raw SVG sets text in the Computer Modern web fonts
 *    (`<text font-family="cmr10">`), which only works where the page loads
 *    those fonts. Ours ends up in an <img> as a data URL, which loads nothing,
 *    so every glyph is replaced by its outline.
 * 2. Theme. A data-URL SVG cannot read the page CSS, so there are two images:
 *    the light one as TeX drew it, and a dark one with black and white swapped
 *    for the dark page's ink and background. Other colours stay.
 */

/** The part of an opentype.js Font this module needs (keeps opentype out of the types). */
export interface GlyphFont {
  forEachGlyph(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options: { kerning: boolean },
    callback: (glyph: GlyphOutline, x: number, y: number, fontSize: number) => void,
  ): number
}

interface GlyphOutline {
  index: number
  getPath(x: number, y: number, fontSize: number): { toPathData(decimalPlaces?: number): string }
}

export type FontLookup = (family: string) => GlyphFont | undefined

/** px per TeX pt on the page: 10pt TeX text comes out at 18px, the size of body text on a page. */
export const TIKZ_SCALE = 1.8

const TEXT_ELEMENT = /<text\b([^>]*)>([^<]*)<\/text>/g

function attribute(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1]
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Replace every <text> by the outlines of its glyphs. Each distinct glyph (per
 * font and size) is defined once and placed with <use>, which keeps a diagram
 * with repeated letters small. Text in an unknown font is dropped and reported.
 */
export function textToPaths(svg: string, font: FontLookup): { svg: string; missingFonts: string[] } {
  const missing = new Set<string>()
  const ids = new Map<string, string>()
  const defs: string[] = []

  const out = svg.replace(TEXT_ELEMENT, (_all, attrs: string, content: string) => {
    const family = attribute(attrs, 'font-family') ?? ''
    const size = parseFloat(attribute(attrs, 'font-size') ?? '10')
    const x = parseFloat(attribute(attrs, 'x') ?? '0')
    const y = parseFloat(attribute(attrs, 'y') ?? '0')
    const fill = attribute(attrs, 'fill') ?? 'black'
    const glyphs = font(family)
    if (!glyphs) {
      missing.add(family)
      return ''
    }
    const uses: string[] = []
    // TeX has already placed every run; inside a run the glyphs follow each
    // other by their plain advance width, as in the browser rendering of dvi2svg.
    glyphs.forEachGlyph(decodeEntities(content), x, y, size, { kerning: false }, (glyph, gx, gy, glyphSize) => {
      const key = `${family}|${glyphSize}|${glyph.index}`
      let id = ids.get(key)
      if (id === undefined) {
        const d = glyph.getPath(0, 0, glyphSize).toPathData(2)
        id = d ? `g${ids.size}` : ''
        ids.set(key, id)
        if (d) defs.push(`<path id="${id}" d="${d}"/>`)
      }
      if (id) uses.push(`<use href="#${id}" x="${round(gx)}" y="${round(gy)}"/>`)
    })
    return uses.length > 0 ? `<g fill="${fill}" stroke="none">${uses.join('')}</g>` : ''
  })

  const withDefs = defs.length > 0 ? out.replace(/(<svg\b[^>]*>)/, `$1<defs>${defs.join('')}</defs>`) : out
  return { svg: withDefs, missingFonts: [...missing] }
}

const round = (value: number) => Math.round(value * 100) / 100

/** Width and height in TeX pt, from the root element. */
export function svgSize(svg: string): { width: number; height: number } | undefined {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0]
  if (!root) return undefined
  const width = parseFloat(attribute(root, 'width') ?? '')
  const height = parseFloat(attribute(root, 'height') ?? '')
  if (!(width > 0) || !(height > 0)) return undefined
  return { width, height }
}

/** Give the root element pixel sizes (TeX pt × TIKZ_SCALE) and drop what an <img> does not need. */
export function sizeSvg(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/, (root) => {
    const viewBox = attribute(root, 'viewBox')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${viewBox ? ` viewBox="${viewBox}"` : ''}>`
  })
}

export const TIKZ_DARK = { ink: '#e5e5e5', paper: '#131313' }

const BLACK = /^(?:black|#000|#000000)$/i
const WHITE = /^(?:white|#fff|#ffffff)$/i

function parseHex(value: string): [number, number, number] | undefined {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  if (short) return [short[1], short[2], short[3]].map((c) => parseInt(c + c, 16)) as [number, number, number]
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (long) return [long[1], long[2], long[3]].map((c) => parseInt(c, 16)) as [number, number, number]
  return undefined
}

/**
 * A pale fill (a highlighted state, a coloured box) would carry light ink in
 * the dark variant and become unreadable, so it is mixed towards the dark page.
 */
function dimPaleFill(value: string): string | undefined {
  const rgb = parseHex(value)
  if (!rgb) return undefined
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  if (luminance < 0.55) return undefined
  const paper = parseHex(TIKZ_DARK.paper)!
  const mixed = rgb.map((channel, i) => Math.round(channel * 0.4 + paper[i] * 0.6))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Dark variant: black ink becomes light, white (used to knock out, e.g. double
 * circles) becomes the dark page colour, pale fills are dimmed. Other colours stay.
 */
export function darkSvg(svg: string): string {
  return svg.replace(/\b(fill|stroke)="([^"]*)"/g, (all, name: string, value: string) => {
    if (BLACK.test(value)) return `${name}="${TIKZ_DARK.ink}"`
    if (WHITE.test(value)) return `${name}="${TIKZ_DARK.paper}"`
    if (name === 'fill') {
      const dimmed = dimPaleFill(value)
      if (dimmed) return `fill="${dimmed}"`
    }
    return all
  })
}

/** Collapse the whitespace dvi2svg leaves between elements and shorten its numbers. */
export function compactSvg(svg: string): string {
  return svg
    // dvi2svg writes xlink:href (patterns, symbols) without declaring the
    // namespace, which makes the file invalid XML as a standalone image.
    .replace(/\bxlink:href=/g, 'href=')
    .replace(/(\d+\.\d{3})\d+/g, '$1')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/<g>\s*<\/g>/g, '')
}
