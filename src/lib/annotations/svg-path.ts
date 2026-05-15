/**
 * SVG Path Utilities for Annotation Rendering
 *
 * Converts perfect-freehand stroke outlines to SVG path `d` attribute strings.
 * Same quadratic curve logic as getPathFromStroke() in simple-canvas.tsx,
 * but outputs SVG commands instead of Path2D objects.
 *
 * Also centralizes stroke options and collision detection as pure data functions.
 *
 * @see simple-canvas.tsx - Canvas-based drawing (uses Path2D)
 * @see annotation-svg-layer.tsx - SVG rendering consumer
 */

import { getStroke } from 'perfect-freehand'
import type { StrokeOptions } from 'perfect-freehand'

export { getStroke }

/**
 * Map stroke width to perfect-freehand options.
 * Width is radius-like; perfect-freehand size is diameter, hence * 2.
 *
 * `last` MUST be true for finalized strokes. Without it, perfect-freehand
 * assumes more points may arrive and pads the terminus with a wide round
 * cap, which renders as a visible blob at the end of the stroke. Pass
 * false (the default) for in-progress rendering during pointermove.
 *
 * `taperEnd` cancels the velocity-driven width spike at stroke end. Pens
 * always decelerate before lift-off, which thinning amplifies into a
 * clubbed terminus; tapering forces the end to thin to a point.
 *
 * `simulate` enables perfect-freehand's velocity-based pressure simulation.
 * Use it for mouse-drawn strokes: mouse events carry constant (0.5) pressure
 * and sparse (~60 Hz) sample rate, so raw stroke outlines are visibly
 * polygonal; simulatePressure adds organic width variation and effectively
 * lets the smoothing/streamline filters produce curvier outlines. Leave it
 * off for stylus input, which has real pressure + high-freq coalesced events.
 */
export function getStrokeOptions(width: number, last = false, simulate = false): StrokeOptions {
  return {
    size: width * 2,
    // Lower thinning on simulated pressure: velocity-derived pressure
    // fluctuates with coalesced-event batching, and at thinning 0.6 those
    // fluctuations show up as visible width wobble / S-curves along the
    // outline. 0.25 keeps a subtle end taper without modulating the body.
    thinning: simulate ? 0.25 : 0.6,
    smoothing: 0.5,
    // Heavier streamline on mouse/synthetic input to compensate for the
    // sparse sample rate; stylus keeps the tighter 0.3 for responsiveness.
    streamline: simulate ? 0.5 : 0.3,
    simulatePressure: simulate,
    last,
    // Taper the terminus to cancel the velocity-driven width spike that
    // appears as a clubbed end (pens always decelerate before lift-off).
    // perfect-freehand's `t` runs 1 (start of taper) → 0 (terminus) and
    // its result multiplies the radius. t^(1/8) holds ~92% width at the
    // halfway point and only collapses near the very tip — visually a
    // crisp snap rather than a soft fade.
    end: { taper: true, easing: (t) => Math.pow(t, 1 / 8) },
  }
}

/**
 * True when every point's pressure matches the first point's. Mouse events
 * always produce the same default pressure (0.5) for every sample, so this
 * reliably distinguishes mouse-drawn strokes from pen-drawn ones without
 * having to store pointerType on the stroke data.
 */
export function hasUniformPressure(points: Array<{ pressure: number }>): boolean {
  if (points.length < 2) return false
  const first = points[0].pressure
  for (let i = 1; i < points.length; i++) {
    if (points[i].pressure !== first) return false
  }
  return true
}

/**
 * Symmetric 5-point moving-average smoothing on the x/y channels of a point
 * series. Endpoints are preserved (visual start/end of the stroke) and the
 * window tapers near them. perfect-freehand's streamline only applies an EMA
 * filter, which has phase lag and leaves sub-pixel mouse jitter as visible
 * waves along the spine; a symmetric MA has zero phase and removes that
 * jitter without lagging the output. Pressure is left untouched.
 *
 * Intended for uniform-pressure (mouse) input; real pen digitizers produce
 * much cleaner coordinates and don't need this extra smoothing.
 */
export function smoothPoints<P extends { x: number; y: number; pressure: number }>(points: P[]): P[] {
  const n = points.length
  if (n < 3) return points
  const out: P[] = new Array(n)
  out[0] = points[0]
  out[n - 1] = points[n - 1]
  const radius = 2
  for (let i = 1; i < n - 1; i++) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n - 1, i + radius)
    let sx = 0, sy = 0, cnt = 0
    for (let j = lo; j <= hi; j++) {
      sx += points[j].x
      sy += points[j].y
      cnt++
    }
    out[i] = { ...points[i], x: sx / cnt, y: sy / cnt }
  }
  return out
}

/**
 * Convert perfect-freehand outline points to an SVG path `d` attribute string.
 * Uses quadratic curves for smoothness (same approach as Path2D version).
 */
export function getSvgPathFromStroke(outlinePoints: number[][]): string {
  if (outlinePoints.length < 2) return ''

  const [x0, y0] = outlinePoints[0]
  let d = `M ${x0} ${y0}`

  for (let i = 1; i < outlinePoints.length - 1; i++) {
    const [cx, cy] = outlinePoints[i]
    const [nx, ny] = outlinePoints[i + 1]
    d += ` Q ${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`
  }

  const [lx, ly] = outlinePoints[outlinePoints.length - 1]
  d += ` L ${lx} ${ly} Z`

  return d
}

/**
 * Check if a point is near a stroke (for eraser collision detection).
 * Pure data function — no DOM or canvas dependency.
 * O(n) per stroke where n = point count.
 */
export function isPointNearStroke(
  px: number,
  py: number,
  strokePoints: Array<{ x: number; y: number }>,
  threshold: number = 20
): boolean {
  for (let i = 0; i < strokePoints.length - 1; i++) {
    const p1 = strokePoints[i]
    const p2 = strokePoints[i + 1]

    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const lengthSquared = dx * dx + dy * dy

    if (lengthSquared === 0) {
      const dist = Math.sqrt((px - p1.x) ** 2 + (py - p1.y) ** 2)
      if (dist < threshold) return true
    } else {
      const t = Math.max(0, Math.min(1, ((px - p1.x) * dx + (py - p1.y) * dy) / lengthSquared))
      const projX = p1.x + t * dx
      const projY = p1.y + t * dy
      const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
      if (dist < threshold) return true
    }
  }
  return false
}
