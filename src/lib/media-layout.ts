/**
 * Width / align / wrap layout for tag-based media (<muxvideo>, <youtube>) —
 * the same three settings the ResizableWrapper gizmo edits for images and
 * <excali> drawings (src/components/markdown/resizable-wrapper.tsx).
 *
 * Markdown syntax matches <excali>: `width="50%" align="left" wrap`.
 * Defaults (100%, center, no wrap) are omitted when serializing.
 */

export type MediaAlign = 'left' | 'center' | 'right'

export interface MediaLayout {
  width: number
  align: MediaAlign
  wrap: boolean
}

/** "50%", "50", 50 → 50. Anything else (missing, "auto", 0) → undefined (= 100%). */
export function parseMediaWidth(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function parseMediaAlign(value: unknown): MediaAlign {
  return value === 'left' || value === 'right' ? value : 'center'
}

/** HTML boolean-attribute presence: a bare `wrap` parses as '' (or true). */
export function parseMediaFlag(value: unknown): boolean {
  return value === true || value === '' || value === 'true'
}

/** Attribute strings for a layout, defaults left out. */
export function mediaLayoutAttrs(layout: MediaLayout): string[] {
  const attrs: string[] = []
  const width = Math.round(layout.width)
  if (width !== 100) attrs.push(`width="${width}%"`)
  if (layout.align !== 'center') attrs.push(`align="${layout.align}"`)
  if (layout.wrap) attrs.push('wrap')
  return attrs
}

/**
 * Replace the width/align/wrap attributes of one opening tag string, keeping
 * every other attribute as written. Accepts `<tag …>` and `<tag … />`.
 *
 * Limitation: a ">" inside an attribute value would have ended the caller's
 * tag match earlier; this function only sees what the caller matched.
 */
export function setMediaLayoutAttrs(tag: string, layout: MediaLayout): string {
  const stripped = tag
    .replace(/\s+(?:width|align)=(\{[^}]*\}|"[^"]*"|'[^']*'|[^\s/>]+)/gi, '')
    .replace(/\s+wrap(?:=(\{[^}]*\}|"[^"]*"|'[^']*'|[^\s/>]+))?(?=[\s/>])/gi, '')
  const attrs = mediaLayoutAttrs(layout)
  if (attrs.length === 0) return stripped
  return stripped.replace(/\s*(\/?>)$/, (_, end: string) => ` ${attrs.join(' ')}${end === '/>' ? ' />' : '>'}`)
}

/**
 * A <youtube> tag replacing the `![caption](youtube-url)` shorthand when the
 * layout gizmo is used on it (the shorthand has no place for layout).
 * Only the fields the shorthand can carry (src/lib/remark-plugins/youtube-image.ts).
 */
export function buildYoutubeTag(opts: {
  id: string
  playlist?: string
  startTime?: number
  endTime?: number
  caption?: string
  layout: MediaLayout
}): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const attrs = [`id="${esc(opts.id)}"`]
  if (opts.playlist) attrs.push(`playlist="${esc(opts.playlist)}"`)
  if (opts.startTime) attrs.push(`startTime="${opts.startTime}"`)
  if (opts.endTime) attrs.push(`endTime="${opts.endTime}"`)
  if (opts.caption) attrs.push(`caption="${esc(opts.caption)}"`)
  attrs.push(...mediaLayoutAttrs(opts.layout))
  return `<youtube ${attrs.join(' ')} />`
}
