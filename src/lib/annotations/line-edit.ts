/**
 * Editing straight strokes after they were drawn.
 *
 * A straightened stroke is exactly two points (see shape-snap.ts) — that is the
 * whole marker. Freehand strokes and recognised circles/rectangles are
 * many-pointed and therefore never editable, which keeps this feature out of
 * the way until we deliberately extend it.
 *
 * Everything here is pure; the DOM side lives in section-anchored-strokes.tsx
 * and the persistence side in annotation-layer.tsx.
 */
import { determineSectionFromY, type HeadingPosition } from './reposition-strokes'

export interface EditPoint {
  x: number
  y: number
  pressure: number
}

export interface EditableStrokeLike {
  points: EditPoint[]
  mode?: string
}

/** Minimum length (paper px) a line keeps — a zero-length line can't be grabbed again. */
const MIN_LENGTH = 4

export function isEditableLine(stroke: EditableStrokeLike): boolean {
  return stroke.mode !== 'erase' && stroke.points.length === 2
}

export function moveLine(points: EditPoint[], dx: number, dy: number): EditPoint[] {
  return points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))
}

/**
 * Move one endpoint. The other end stays put; the result keeps a minimum length
 * so a line collapsed onto itself doesn't become impossible to hit.
 */
export function moveEndpoint(points: EditPoint[], index: 0 | 1, x: number, y: number): EditPoint[] {
  const other = points[index === 0 ? 1 : 0]
  const length = Math.hypot(x - other.x, y - other.y)
  if (length < MIN_LENGTH) {
    const angle = length === 0 ? 0 : Math.atan2(y - other.y, x - other.x)
    x = other.x + Math.cos(angle) * MIN_LENGTH
    y = other.y + Math.sin(angle) * MIN_LENGTH
  }
  const next = [...points]
  next[index] = { ...points[index], x, y }
  return next
}

/**
 * Re-derive the fields that tie a stroke to its section after it moved.
 *
 * Without this a line dragged into another section keeps the old anchor and
 * jumps back the next time that section reflows — the same trap sticky notes
 * solve with `anchorForY` (components/annotations/sticky-notes-layer.tsx).
 * Returns only the fields that change, so callers can spread it.
 */
export function reanchorLine(
  points: EditPoint[],
  headingPositions: HeadingPosition[]
): { sectionId?: string; sectionOffsetY?: number; avgX: number; avgY: number } {
  const avgX = points.reduce((sum, p) => sum + p.x, 0) / points.length
  const avgY = points.reduce((sum, p) => sum + p.y, 0) / points.length

  if (headingPositions.length === 0) return { avgX, avgY }

  // Anchor on the FIRST point, matching how simple-canvas assigns a section at
  // draw time — otherwise a line whose midpoint crosses a heading would anchor
  // differently depending on whether it was drawn or dragged there.
  const sectionId = determineSectionFromY(points[0].y, headingPositions)
  if (!sectionId) return { avgX, avgY }

  const sectionOffsetY = headingPositions.find((h) => h.sectionId === sectionId)?.offsetY
  return { sectionId, sectionOffsetY, avgX, avgY }
}
