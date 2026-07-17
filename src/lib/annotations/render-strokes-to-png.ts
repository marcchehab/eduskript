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

import {
  getStroke,
  getStrokeOptions,
  getSvgPathFromStroke,
  hasUniformPressure,
  smoothPoints,
} from './svg-path'

export interface RenderableStroke {
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
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

  for (const s of drawable) {
    const uniform = hasUniformPressure(s.points)
    const source = uniform ? smoothPoints(s.points) : s.points
    const input = source.map((p) => [p.x, p.y + s.yShift, p.pressure])
    const outline = getStroke(input, getStrokeOptions(s.width, true, uniform))
    const d = getSvgPathFromStroke(outline)
    if (!d) continue
    ctx.fillStyle = s.color
    ctx.fill(new Path2D(d))
  }

  // Composited photos can blow up PNG size; the route caps the data URL length.
  let dataUrl = canvas.toDataURL('image/png')
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  }
  return { dataUrl, width: canvas.width, height: canvas.height }
}
