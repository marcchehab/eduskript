/**
 * Offscreen stroke → PNG rendering for AI feedback.
 *
 * Renders a set of already-filtered strokes onto an offscreen canvas and
 * returns a PNG data URL. Coordinates: caller passes strokes with a per-stroke
 * `yShift` (live section top − stored sectionOffsetY) so points land where
 * they currently render on screen; x is used as stored (paper-absolute).
 *
 * Optionally composites page images (content images, excalidraw SVGs) under
 * the strokes at their live paper positions, so drawing ON an image works
 * without a screenshot. Alignment holds because both image rects and stroke
 * shifts are measured from the same live DOM at the same instant. Images must
 * be CORS-clean (see loadCorsSafeImage in ai-feedback.tsx) or the canvas
 * would taint and toDataURL would throw.
 *
 * Crops to the union of the strokes' and images' bounding boxes (padded) —
 * handwriting legibility for the vision model matters more than layout
 * context, and the exercise text travels separately as markdown.
 *
 * Same perfect-freehand recipe as section-anchored-strokes.tsx / simple-canvas.tsx:
 * fill the outline polygon, never stroke segments; smooth + simulate pressure
 * for uniform-pressure (mouse) strokes.
 *
 * @see src/lib/annotations/svg-path.ts - shared stroke outline helpers
 * @see src/components/markdown/ai-feedback.tsx - consumer
 */

import { getSvgPathFromStroke, HIGHLIGHTER_OPACITY_LIGHT, isHighlighterStroke, strokeOutline } from './svg-path'

export interface RenderableStroke {
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
  /** 'highlighter' → translucent, multiplied, under the pen strokes. */
  tool?: 'highlighter'
  /** Live section top (paper coords) minus stored sectionOffsetY. */
  yShift: number
}

/** An image to composite under the strokes, in paper coordinates. */
export interface RenderableImage {
  source: CanvasImageSource
  x: number
  y: number
  w: number
  h: number
}

const PADDING = 24
/** Cap the longest canvas edge (device pixels) — data-URL size and model input cost. */
const MAX_EDGE = 2000
const SCALE = 2
/** Stay under the route's 6M-char limit; fall back to JPEG above this. */
const MAX_DATA_URL_CHARS = 5_500_000

export function renderStrokesToPng(
  strokes: RenderableStroke[],
  images: RenderableImage[] = []
): { dataUrl: string; width: number; height: number } | null {
  const drawable = strokes.filter((s) => s.mode === 'draw' && s.points.length >= 2)
  if (drawable.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const img of images) {
    if (img.x < minX) minX = img.x
    if (img.y < minY) minY = img.y
    if (img.x + img.w > maxX) maxX = img.x + img.w
    if (img.y + img.h > maxY) maxY = img.y + img.h
  }
  for (const s of drawable) {
    // Half stroke width so thick pens aren't clipped at the bbox edge
    const r = s.width
    for (const p of s.points) {
      const y = p.y + s.yShift
      if (p.x - r < minX) minX = p.x - r
      if (p.x + r > maxX) maxX = p.x + r
      if (y - r < minY) minY = y - r
      if (y + r > maxY) maxY = y + r
    }
  }

  minX -= PADDING
  minY -= PADDING
  maxX += PADDING
  maxY += PADDING

  const logicalW = maxX - minX
  const logicalH = maxY - minY
  if (logicalW <= 0 || logicalH <= 0) return null

  const scale = Math.min(SCALE, MAX_EDGE / Math.max(logicalW, logicalH))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(logicalW * scale)
  canvas.height = Math.round(logicalH * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.translate(-minX, -minY)

  for (const img of images) {
    ctx.drawImage(img.source, img.x, img.y, img.w, img.h)
  }

  // Highlighters first, pens on top. Highlighters are filled opaque on their
  // own layer, then composited once at HIGHLIGHTER_OPACITY_LIGHT with multiply
  // (like the group-opacity SVG on screen), so overlaps never darken.
  const fillStroke = (target: CanvasRenderingContext2D, s: (typeof drawable)[number]) => {
    const d = getSvgPathFromStroke(strokeOutline(s.points, s.width, s.tool, true, 0, s.yShift))
    if (!d) return
    target.fillStyle = s.color
    target.fill(new Path2D(d))
  }
  const highlighters = drawable.filter(isHighlighterStroke)
  if (highlighters.length > 0) {
    const layer = document.createElement('canvas')
    layer.width = canvas.width
    layer.height = canvas.height
    const lctx = layer.getContext('2d')
    if (lctx) {
      lctx.scale(scale, scale)
      lctx.translate(-minX, -minY)
      for (const s of highlighters) fillStroke(lctx, s)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = HIGHLIGHTER_OPACITY_LIGHT
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(layer, 0, 0)
      ctx.restore()
    }
  }
  for (const s of drawable) {
    if (!isHighlighterStroke(s)) fillStroke(ctx, s)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  // Composited photos can blow up PNG size; the route caps the data URL length.
  let dataUrl = canvas.toDataURL('image/png')
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  }
  return { dataUrl, width: canvas.width, height: canvas.height }
}
