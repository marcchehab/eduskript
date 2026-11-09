/**
 * Eraser variants and the point eraser's stroke splitting.
 *
 * - 'stroke' (default): touching a stroke deletes the whole stroke. Hit-test
 *   lives in simple-canvas.tsx (isPointNearStroke).
 * - 'point': a circular rubber. Ink under the circle is removed; every
 *   remaining contiguous run of a stroke becomes its own stroke with a new id.
 *
 * Splitting is analytic: each polyline segment is clipped against the circle,
 * so the cut lands exactly on the circle boundary (with linearly interpolated
 * pressure) no matter how far apart the stored points are. That covers
 * straightened two-point lines without resampling: a line cut in the middle
 * becomes two two-point lines, which stay straight lines (still draggable via
 * line-edit.ts) instead of turning into many-point freehand strokes.
 *
 * Everything here is pure; the pointer handling is in simple-canvas.tsx and
 * persistence goes through annotation-layer.tsx's handleCanvasUpdate (the
 * same path a drawn stroke or a stroke-eraser deletion takes).
 */

import { safeRandomUUID } from '@/lib/uuid'

export type EraserVariant = 'stroke' | 'point'

export const DEFAULT_ERASER_VARIANT: EraserVariant = 'stroke'

/** Point-eraser radius in paper px. Paper px scale with zoom like pen widths. */
export const POINT_ERASER_RADIUS = 12

/** Pieces whose polyline is shorter than this (paper px) are dropped. */
const MIN_PIECE_LENGTH = 1

const STORAGE_KEY = 'annotation-eraser-variant'

export function loadEraserVariant(): EraserVariant {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'point' || v === 'stroke' ? v : DEFAULT_ERASER_VARIANT
  } catch {
    return DEFAULT_ERASER_VARIANT
  }
}

export function saveEraserVariant(variant: EraserVariant): void {
  try {
    localStorage.setItem(STORAGE_KEY, variant)
  } catch {
    // Private mode / storage disabled — the choice just isn't remembered.
  }
}

export interface ErasePoint {
  x: number
  y: number
  pressure: number
}

export interface ErasableStroke {
  id: string
  points: ErasePoint[]
  /** Stroke radius (see svg-path.ts getStrokeOptions: size = width * 2). */
  width: number
  mode?: string
  avgX?: number
  avgY?: number
}

function lerp(a: ErasePoint, b: ErasePoint, t: number): ErasePoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
  }
}

/**
 * Remove the parts of a polyline strictly inside the circle (cx, cy, r).
 *
 * Returns `null` when the circle does not touch the polyline (caller keeps the
 * stroke as is), otherwise the remaining runs in order — possibly `[]` when
 * everything was inside. Runs are not filtered here. O(points).
 */
export function cutPolyline(points: ErasePoint[], cx: number, cy: number, r: number): ErasePoint[][] | null {
  const r2 = r * r
  if (points.length === 0) return null
  if (points.length === 1) {
    const p = points[0]
    return (p.x - cx) ** 2 + (p.y - cy) ** 2 < r2 ? [] : null
  }

  const runs: ErasePoint[][] = []
  let cur: ErasePoint[] = []
  let touched = false
  const closeRun = () => {
    if (cur.length > 0) runs.push(cur)
    cur = []
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const fx = a.x - cx
    const fy = a.y - cy
    const A = dx * dx + dy * dy
    const C = fx * fx + fy * fy - r2

    if (A === 0) {
      // Duplicate point: inside or not, as a whole.
      if (C < 0) {
        touched = true
        closeRun()
      } else {
        if (cur.length === 0) cur.push(a)
        cur.push(b)
      }
      continue
    }

    // |a + t(b - a) - c|² = r²  →  A t² + B t + C = 0; inside for t in (t0, t1).
    const B = 2 * (fx * dx + fy * dy)
    const disc = B * B - 4 * A * C
    let overlap = false
    let t0 = 0
    let t1 = 0
    if (disc > 0) {
      const s = Math.sqrt(disc)
      t0 = (-B - s) / (2 * A)
      t1 = (-B + s) / (2 * A)
      overlap = t0 < 1 && t1 > 0
    }

    if (!overlap) {
      // a and b are outside (or exactly on the boundary).
      if (cur.length === 0) cur.push(a)
      cur.push(b)
      continue
    }

    touched = true
    if (t0 > 0) {
      // Enters the circle inside this segment: end the run at the entry point.
      if (cur.length === 0) cur.push(a)
      cur.push(lerp(a, b, t0))
    }
    closeRun()
    if (t1 < 1) {
      // Leaves the circle inside this segment: start a new run at the exit.
      cur = [lerp(a, b, t1), b]
    }
  }
  closeRun()

  return touched ? runs : null
}

function polylineLength(points: ErasePoint[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

/** Axis-aligned bounds of a stroke's points, cached per stroke object.
 *  Stroke objects are treated as immutable (replaced, never mutated), so the
 *  cache stays valid for an object's lifetime. */
const boundsCache = new WeakMap<object, { minX: number; minY: number; maxX: number; maxY: number }>()

export function strokeBounds(stroke: { points: ErasePoint[] }) {
  let b = boundsCache.get(stroke)
  if (!b) {
    b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const p of stroke.points) {
      if (p.x < b.minX) b.minX = p.x
      if (p.y < b.minY) b.minY = p.y
      if (p.x > b.maxX) b.maxX = p.x
      if (p.y > b.maxY) b.maxY = p.y
    }
    boundsCache.set(stroke, b)
  }
  return b
}

/**
 * Apply the point eraser at (cx, cy) to one stroke.
 *
 * The cut radius is `eraserRadius + stroke.width`: `width` is the ink's radius
 * around the centreline, so the visible ink ends at the eraser's edge rather
 * than poking a round cap into it. Wide highlighters are therefore cut as
 * soon as the circle touches their visible band.
 *
 * Returns `null` if the stroke is untouched. Otherwise the replacement pieces
 * (possibly `[]`): each piece is a shallow copy of the original — colour,
 * width, tool, mode, sectionId, sectionOffsetY and any other field kept —
 * with a new id, its own points (original pressure kept, interpolated at the
 * cut) and recomputed avgX/avgY. Pieces with < 2 points or shorter than
 * MIN_PIECE_LENGTH are dropped.
 *
 * A two-point piece cut from a freehand stroke (> 2 points) gets its midpoint
 * inserted: two points is the marker for a straightened, draggable line
 * (line-edit.ts isEditableLine), which a fragment of handwriting is not.
 *
 * Cost: O(1) bounding-box reject, else O(points of this stroke).
 */
export function splitStrokeAtCircle<T extends ErasableStroke>(
  stroke: T,
  cx: number,
  cy: number,
  eraserRadius: number,
  makeId: () => string = safeRandomUUID,
): T[] | null {
  if (stroke.mode === 'erase') return null
  const r = eraserRadius + (stroke.width || 0)
  const b = strokeBounds(stroke)
  if (cx + r < b.minX || cx - r > b.maxX || cy + r < b.minY || cy - r > b.maxY) return null

  const runs = cutPolyline(stroke.points, cx, cy, r)
  if (!runs) return null

  const wasFreehand = stroke.points.length > 2
  const pieces: T[] = []
  for (let run of runs) {
    if (run.length < 2 || polylineLength(run) < MIN_PIECE_LENGTH) continue
    if (run.length === 2 && wasFreehand) run = [run[0], lerp(run[0], run[1], 0.5), run[1]]
    let avgX = 0
    let avgY = 0
    for (const p of run) {
      avgX += p.x
      avgY += p.y
    }
    pieces.push({ ...stroke, id: makeId(), points: run, avgX: avgX / run.length, avgY: avgY / run.length })
  }
  return pieces
}

/**
 * Eraser sample positions from `from` to `to`, at most `step` apart
 * (excluding `from`, including `to`). A fast pointer can jump more than the
 * eraser diameter between two events; sampling the gap keeps the rubbed path
 * continuous instead of leaving ink islands between the samples.
 */
export function eraserSamples(
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  step: number,
): Array<{ x: number; y: number }> {
  if (!from) return [to]
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const n = Math.max(1, Math.ceil(dist / step))
  const out: Array<{ x: number; y: number }> = []
  for (let i = 1; i <= n; i++) {
    out.push({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n })
  }
  return out
}
