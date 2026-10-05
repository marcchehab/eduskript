import type { TemplateMeta } from './index'

export const MAX_TEMPLATE_BYTES = 3_000_000
const AUTO_ID = /^(path|g|svg|layer|rect|circle|ellipse|polygon|polyline|use|defs|text|tspan|title|metadata|clippath|mask)[-_]?\d+$/i

/** Wikimedia blank maps use ISO 3166 alpha-2 ids without names: "dz" → "Algerien". */
const regionNames = (() => { try { return new Intl.DisplayNames(['de'], { type: 'region' }) } catch { return null } })()
function countryName(id: string): string | null {
  if (!/^[a-z]{2}$/i.test(id) || !regionNames) return null
  const name = regionNames.of(id.toUpperCase())
  return name && name !== id.toUpperCase() ? name : null
}
const SHAPE_TAGS = 'path|polygon|polyline|rect|circle|ellipse|g'

/**
 * Clean a teacher-supplied SVG and work out its addressable parts.
 *
 * Regex-based, not a full XML parser. That is acceptable here because the
 * result is only ever rendered inside the plugin iframe, which already runs
 * arbitrary plugin JavaScript; the goal is a tidy, script-free SVG, not a
 * security boundary. Removes: XML prolog/doctype, comments, <script>,
 * <foreignObject>, on*= handlers, javascript: hrefs, width/height on the root.
 *
 * Shapes: elements with an id get data-id (copied from id) and data-name
 * (from data-name, inkscape:label or a <title> child, else the id). Limited
 * to 400 so the AI prompt stays small.
 */
export function sanitizeSvg(raw: string, slug: string): { svg: string; meta: TemplateMeta } {
  if (raw.length > MAX_TEMPLATE_BYTES) throw new Error('The SVG is larger than 3 MB.')
  let s = raw
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#')
    .trim()
  const open = /<svg\b[^>]*>/i.exec(s)
  if (!open || !/<\/svg>\s*$/i.test(s)) throw new Error('This file is not an SVG image.')
  // Without a viewBox the SVG only scales via width/height, which are removed
  // below, so derive one from them first (Inkscape files often lack it).
  let rootTag = open[0]
  if (!/\sviewBox\s*=/i.test(rootTag)) {
    const w = parseFloat(/\swidth\s*=\s*["']([\d.]+)/i.exec(rootTag)?.[1] ?? '')
    const h = parseFloat(/\sheight\s*=\s*["']([\d.]+)/i.exec(rootTag)?.[1] ?? '')
    if (w > 0 && h > 0) rootTag = rootTag.replace(/^<svg/i, `<svg viewBox="0 0 ${w} ${h}"`)
  }
  const root = rootTag
    .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, '')
    .replace(/\sclass\s*=\s*("[^"]*"|'[^']*')/i, '')
    // class="es-shapes" on the root, so the same CSS (.es-shapes [data-id]) works
    // as for the built-ins, whose shapes sit in a <g class="es-shapes">.
    .replace(/^<svg/i, `<svg class="es-shapes" data-template="${slug}" style="width:100%;height:auto;display:block"`)
  s = s.slice(0, open.index) + root + s.slice(open.index + open[0].length)

  const shapes: TemplateMeta['shapes'] = []
  const re = new RegExp(`<(${SHAPE_TAGS})\\b([^>]*?)\\sid\\s*=\\s*"([^"]+)"([^>]*)>`, 'gi')
  s = s.replace(re, (whole: string, tag: string, before: string, id: string, after: string, offset: number, src: string) => {
    if (/data-id\s*=/.test(before + after)) return whole
    const attrs = before + after
    const label = /data-name\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? /inkscape:label\s*=\s*"([^"]+)"/.exec(attrs)?.[1]
    // <title> right after the opening tag (Wikimedia maps use this for names)
    const rest = src.slice(offset + whole.length, offset + whole.length + 200)
    const title = /^\s*<title>([^<]{1,80})<\/title>/.exec(rest)?.[1]
    const name = (label || title || countryName(id) || id).trim()
    // Editor-generated ids (path3021, g123, layer1) are not meaningful parts.
    if (!label && !title && AUTO_ID.test(id)) return whole
    if (shapes.length < 400) shapes.push({ id, name })
    const nameAttr = /data-name\s*=/.test(attrs) ? '' : ` data-name="${name.replace(/"/g, '&quot;')}"`
    return `<${tag}${before} id="${id}" data-id="${id}"${nameAttr}${after}>`
  })
  return { svg: s, meta: { shapes, points: [] } }
}
