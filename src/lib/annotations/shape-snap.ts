/**
 * Straightening and shape recognition for hand-drawn strokes.
 *
 * Two entry points, both pure:
 *   - `straightenPath` — the Shift path: replace a stroke with the straight line
 *     from where it started to where the pointer is now, optionally snapped to a
 *     15° grid (Shift+Alt).
 *   - `recognizeShape` — the hold-to-snap path: after the pointer has been still
 *     for a moment, guess whether the stroke wants to be a line, a circle or a
 *     rectangle. Returns null when nothing fits well; a wrong guess is worse
 *     than none, so the thresholds are deliberately strict.
 *
 * Output is always a plain point list with uniform pressure, so the result draws
 * as an even-width stroke and travels through the normal commit path (no new
 * data shape, no migration).
 */

export interface StrokePoint {
  x: number
  y: number
  pressure: number
}

export type ShapeKind = 'line' | 'circle' | 'rect'

/** Angle grid for Shift+Alt, in degrees. */
export const SNAP_ANGLE_DEG = 15
/** How long the pointer must hold still before the shape snap fires. */
export const HOLD_SNAP_MS = 500
/** Movement below this (paper px) still counts as holding still. */
export const HOLD_SNAP_TOLERANCE_PX = 3

/** Points sampled along a recognised circle or rectangle. */
const CIRCLE_SAMPLES = 64

export function straightenPath(points: StrokePoint[], snapAngle = false): StrokePoint[] {
  if (points.length < 2) return points
  const start = points[0]
  const end = points[points.length - 1]
  const pressure = averagePressure(points)

  if (!snapAngle) {
    return [
      { x: start.x, y: start.y, pressure },
      { x: end.x, y: end.y, pressure },
    ]
  }

  // Keep the drawn length, rotate the endpoint onto the nearest grid angle —
  // the line follows the hand instead of jumping to a different length.
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const step = (SNAP_ANGLE_DEG * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return [
    { x: start.x, y: start.y, pressure },
    { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length, pressure },
  ]
}

/**
 * Guess the shape behind a stroke. Returns null when the stroke doesn't clearly
 * want to be anything — freehand notes must never be "corrected" by accident.
 */
export function recognizeShape(
  points: StrokePoint[]
): { kind: ShapeKind; points: StrokePoint[] } | null {
  if (points.length < 4) return null

  const pathLength = totalLength(points)
  if (pathLength < 20) return null // A dot or a tick — leave it alone.

  const start = points[0]
  const end = points[points.length - 1]
  const gap = Math.hypot(end.x - start.x, end.y - start.y)
  const closed = gap < pathLength * 0.25

  if (!closed) {
    // Straight enough? Measure the worst deviation from the start-end chord.
    const deviation = maxDistanceToLine(points, start, end)
    const span = Math.hypot(end.x - start.x, end.y - start.y)
    if (span > 0 && deviation / span < 0.12) {
      return { kind: 'line', points: straightenPath(points) }
    }
    return null
  }

  const box = bounds(points)
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY

  // Perimeter ratio: how long is the stroke compared to its bounding box?
  // A rectangle traces 2(w+h), an ellipse only ≈ π(w+h)/2 ≈ 1.57(w+h). This is
  // what separates the two — "most points sit near a box edge" does not: on a
  // circle of radius 50 the points spend most of their angle within 15 px of
  // some edge, so that test alone calls a circle a rectangle.
  const perimeterRatio = width + height > 0 ? pathLength / (width + height) : 0

  if (width >= 12 && height >= 12 && perimeterRatio > 1.8) {
    const tolerance = Math.min(width, height) * 0.15
    const onEdge = points.filter((p) => distanceToBoxEdge(p, box) <= tolerance).length
    if (onEdge / points.length > 0.85) {
      return { kind: 'rect', points: sampleRect(box, averagePressure(points)) }
    }
  }

  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  const radii = points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))
  const meanRadius = radii.reduce((a, b) => a + b, 0) / radii.length
  if (meanRadius < 8) return null

  const radiusSpread =
    radii.reduce((sum, r) => sum + Math.abs(r - meanRadius), 0) / radii.length / meanRadius

  // A circle keeps a near-constant radius; a slightly oval hand-drawn one still
  // passes and is redrawn round, which is what the drawer meant.
  if (radiusSpread < 0.12) {
    return { kind: 'circle', points: sampleCircle(centre, meanRadius, averagePressure(points)) }
  }

  return null
}

// --- helpers ----------------------------------------------------------------

function averagePressure(points: StrokePoint[]): number {
  const sum = points.reduce((acc, p) => acc + (p.pressure || 0.5), 0)
  return sum / points.length
}

function totalLength(points: StrokePoint[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return length
}

function maxDistanceToLine(points: StrokePoint[], a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return 0
  let worst = 0
  for (const p of points) {
    const distance = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length
    if (distance > worst) worst = distance
  }
  return worst
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function bounds(points: StrokePoint[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

function distanceToBoxEdge(p: StrokePoint, box: Box): number {
  return Math.min(
    Math.abs(p.x - box.minX),
    Math.abs(p.x - box.maxX),
    Math.abs(p.y - box.minY),
    Math.abs(p.y - box.maxY)
  )
}

function sampleCircle(centre: { x: number; y: number }, radius: number, pressure: number): StrokePoint[] {
  const points: StrokePoint[] = []
  for (let i = 0; i <= CIRCLE_SAMPLES; i++) {
    const angle = (i / CIRCLE_SAMPLES) * Math.PI * 2
    points.push({
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
      pressure,
    })
  }
  return points
}

/** Corners plus a few points per edge, so perfect-freehand keeps the edges flat. */
function sampleRect(box: Box, pressure: number): StrokePoint[] {
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
    { x: box.minX, y: box.minY },
  ]
  const points: StrokePoint[] = []
  for (let i = 1; i < corners.length; i++) {
    const from = corners[i - 1]
    const to = corners[i]
    const steps = 8
    for (let s = 0; s < steps; s++) {
      points.push({
        x: from.x + ((to.x - from.x) * s) / steps,
        y: from.y + ((to.y - from.y) * s) / steps,
        pressure,
      })
    }
  }
  points.push({ ...corners[0], pressure })
  return points
}
