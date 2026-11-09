/**
 * Lasso selection of annotation strokes — pure geometry and stroke edits.
 *
 * Gesture (simple-canvas.tsx): in draw mode, draw a closed-ish loop and hold
 * still at its end (the same hold that triggers the shape snap, HOLD_SNAP_MS).
 * If the loop encloses at least one stroke of the active layer, the loop is
 * discarded and those strokes become the selection; otherwise the hold falls
 * through to the shape snap exactly as before.
 *
 * Coordinates: the lasso polygon is in LIVE paper coords (where strokes are
 * painted now). Stored strokes are in their draw-time paper coords; the live
 * position is stored y + a per-section shift (liveSectionYShift). Every
 * function here takes that shift as `shiftFor(stroke)`.
 *
 * The UI + persistence live in annotation-selection.tsx and
 * annotation-layer.tsx. Every edit (move / delete / duplicate) returns ONE new
 * stroke array that the layer commits through handleCanvasUpdate — the same
 * save/sync path a drawn stroke takes.
 */

import { safeRandomUUID } from '@/lib/uuid'

export interface SelPoint {
  x: number
  y: number
  pressure: number
}

export interface SelectableStroke {
  id: string
  points: SelPoint[]
  mode?: string
  sectionId?: string
  sectionOffsetY?: number
  avgX?: number
  avgY?: number
}

export type ShiftFor = (stroke: SelectableStroke) => number

/** Section anchor for a stroke at the given live paper points. */
export type AnchorFor = (points: SelPoint[]) => { sectionId: string; sectionOffsetY: number }

/** A stroke counts as enclosed when at least this share of its points lies inside the loop… */
export const ENCLOSED_POINT_SHARE = 0.5
/** Loop end must come back to within max(this, LASSO_CLOSE_RATIO × loop diagonal) of its start. */
export const LASSO_CLOSE_MIN_PX = 30
export const LASSO_CLOSE_RATIO = 0.35
/** Loops smaller than this (paper px, both bbox sides) are never a lasso — they are dots/ticks. */
export const LASSO_MIN_SIZE_PX = 20
/** Offset of a duplicate from its original (paper px, x and y). */
export const DUPLICATE_OFFSET_PX = 20

/** Even-odd ray casting. The polygon is implicitly closed. O(polygon). */
export function pointInPolygon(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * True when the path is a closed-ish loop big enough to be a lasso: its end is
 * back near its start (closing gap ≤ max(LASSO_CLOSE_MIN_PX, LASSO_CLOSE_RATIO ×
 * bbox diagonal)) and its bbox is at least LASSO_MIN_SIZE_PX in both directions.
 */
export function isLassoLoop(path: Array<{ x: number; y: number }>): boolean {
  if (path.length < 8) return false
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of path) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const w = maxX - minX
  const h = maxY - minY
  if (w < LASSO_MIN_SIZE_PX || h < LASSO_MIN_SIZE_PX) return false
  const first = path[0]
  const last = path[path.length - 1]
  const gap = Math.hypot(last.x - first.x, last.y - first.y)
  return gap <= Math.max(LASSO_CLOSE_MIN_PX, LASSO_CLOSE_RATIO * Math.hypot(w, h))
}

/**
 * Ids of the strokes the loop encloses: the centre of the stroke's bbox is
 * inside the loop AND at least ENCLOSED_POINT_SHARE of its points are. The
 * centre test keeps a long stroke that merely dips into the loop out; the
 * share test keeps a stroke whose bbox centre happens to fall inside (an L
 * shape around the loop) out. For a two-point line: centre + one endpoint.
 *
 * Cost: O(strokes × points × loop points) worst case; a bbox reject against
 * the loop's bbox skips strokes that cannot be inside.
 */
export function findEnclosedStrokes<T extends SelectableStroke>(
  strokes: T[],
  loop: Array<{ x: number; y: number }>,
  shiftFor: ShiftFor = () => 0,
): string[] {
  if (loop.length < 3) return []
  let lMinX = Infinity, lMinY = Infinity, lMaxX = -Infinity, lMaxY = -Infinity
  for (const p of loop) {
    if (p.x < lMinX) lMinX = p.x
    if (p.y < lMinY) lMinY = p.y
    if (p.x > lMaxX) lMaxX = p.x
    if (p.y > lMaxY) lMaxY = p.y
  }
  const ids: string[] = []
  for (const s of strokes) {
    if (s.mode === 'erase' || s.points.length === 0) continue
    const shift = shiftFor(s)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of s.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    minY += shift
    maxY += shift
    if (maxX < lMinX || minX > lMaxX || maxY < lMinY || minY > lMaxY) continue
    if (!pointInPolygon((minX + maxX) / 2, (minY + maxY) / 2, loop)) continue
    let inside = 0
    for (const p of s.points) if (pointInPolygon(p.x, p.y + shift, loop)) inside++
    if (inside / s.points.length >= ENCLOSED_POINT_SHARE) ids.push(s.id)
  }
  return ids
}

/** Live-coords bounding box of the given strokes, or null if none. */
export function selectionBounds<T extends SelectableStroke>(
  strokes: T[],
  ids: ReadonlySet<string>,
  shiftFor: ShiftFor = () => 0,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of strokes) {
    if (!ids.has(s.id)) continue
    const shift = shiftFor(s)
    for (const p of s.points) {
      if (p.x < minX) minX = p.x
      if (p.y + shift < minY) minY = p.y + shift
      if (p.x > maxX) maxX = p.x
      if (p.y + shift > maxY) maxY = p.y + shift
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

function averages(points: SelPoint[]) {
  let avgX = 0
  let avgY = 0
  for (const p of points) {
    avgX += p.x
    avgY += p.y
  }
  return { avgX: avgX / points.length, avgY: avgY / points.length }
}

/**
 * A copy of `stroke` moved by (dx, dy) and re-anchored. The points are first
 * rebased to live coords (stored + shift), moved, then given the anchor of the
 * section they now sit in (anchor on the FIRST point, as the draw path does).
 * With `anchorFor` measuring the live section top, the moved stroke has zero
 * shift afterwards and stays put on reflow. Pass `anchorFor = null` for a
 * preview: points move in stored coords and keep the old anchor.
 */
function translated<T extends SelectableStroke>(
  stroke: T,
  dx: number,
  dy: number,
  shiftFor: ShiftFor,
  anchorFor: AnchorFor | null,
  id = stroke.id,
): T {
  const shift = anchorFor ? shiftFor(stroke) : 0
  const points = stroke.points.map(p => ({ ...p, x: p.x + dx, y: p.y + shift + dy }))
  return {
    ...stroke,
    id,
    points,
    ...averages(points),
    ...(anchorFor ? anchorFor(points) : {}),
  }
}

/** Move the selected strokes; others are returned unchanged (same objects, same order). */
export function moveStrokes<T extends SelectableStroke>(
  strokes: T[],
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
  shiftFor: ShiftFor,
  anchorFor: AnchorFor | null,
): T[] {
  return strokes.map(s => (ids.has(s.id) ? translated(s, dx, dy, shiftFor, anchorFor) : s))
}

export function deleteStrokes<T extends SelectableStroke>(strokes: T[], ids: ReadonlySet<string>): T[] {
  return strokes.filter(s => !ids.has(s.id))
}

/**
 * Append offset copies (new ids, re-anchored) of the selected strokes, in
 * their original order, on top of everything. Returns the new list and the
 * copies' ids (the caller selects the copies).
 */
export function duplicateStrokes<T extends SelectableStroke>(
  strokes: T[],
  ids: ReadonlySet<string>,
  shiftFor: ShiftFor,
  anchorFor: AnchorFor,
  offset = DUPLICATE_OFFSET_PX,
  makeId: () => string = safeRandomUUID,
): { strokes: T[]; newIds: string[] } {
  const copies = strokes
    .filter(s => ids.has(s.id))
    .map(s => translated(s, offset, offset, shiftFor, anchorFor, makeId()))
  return { strokes: [...strokes, ...copies], newIds: copies.map(c => c.id) }
}
