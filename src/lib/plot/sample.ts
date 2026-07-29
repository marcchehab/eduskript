/**
 * Sampling: term → screen-ready polyline segments.
 *
 * Three jobs the naive "evaluate 1000 points and connect them" approach gets
 * wrong: poles (a vertical line straight through the plot at 1/x and tan),
 * enormous pixel values in the path data, and byte count.
 */
import { quantile } from 'd3-array'

/** Samples per pixel of plot width. Sub-pixel spacing buys nothing beyond this. */
const SAMPLES_PER_PIXEL = 2
const MAX_SAMPLES = 4000
/** Ramer–Douglas–Peucker tolerance in pixels; 0.25 px is invisible even at DPR 3. */
const SIMPLIFY_EPSILON = 0.25

export interface Sample {
  x: number
  y: number
}

/**
 * Evaluate `fn` across [xMin, xMax] and split into continuous runs. A run ends
 * at a non-finite value or at a pole (see isPole).
 */
export function sampleCurve(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  pixelWidth: number,
  yScale: (y: number) => number,
  yPixelSpan: number,
  ySpanData = 1
): Sample[][] {
  const count = Math.min(MAX_SAMPLES, Math.max(64, Math.round(pixelWidth * SAMPLES_PER_PIXEL)))
  const step = (xMax - xMin) / count

  const runs: Sample[][] = []
  let current: Sample[] = []
  let previous: Sample | null = null

  for (let i = 0; i <= count; i++) {
    const x = xMin + i * step
    const y = fn(x)

    if (!Number.isFinite(y)) {
      if (current.length) runs.push(current)
      current = []
      previous = null
      continue
    }

    const point = { x, y }
    if (previous && isPole(fn, previous, point, yScale, yPixelSpan, ySpanData)) {
      if (current.length) runs.push(current)
      current = []
    }
    current.push(point)
    previous = point
  }
  if (current.length) runs.push(current)

  return runs.filter((run) => run.length > 1)
}

/** Bisection steps used to tell a pole from a fast zero crossing. */
const POLE_BISECTIONS = 12
/** |f| beyond this multiple of the visible y-span counts as "blew up". */
const POLE_FACTOR = 100

/**
 * Pole versus merely steep.
 *
 * Cheap gate first: the neighbours must be further apart than the whole plot
 * height AND have opposite signs — a pole flips the branch, exp(x) never does.
 *
 * Then bisect towards where the sign flip lives. At a pole the values grow
 * without bound (1/x, tan) and we break the path; at a continuous crossing —
 * `1000x` drawn on a narrow window, say — they shrink towards zero and the
 * segment stays. A single midpoint probe is not enough: the pole rarely sits in
 * the middle of a sample interval, so one probe can land on a smaller value than
 * its neighbour and read as harmless.
 */
function isPole(
  fn: (x: number) => number,
  a: Sample,
  b: Sample,
  yScale: (y: number) => number,
  yPixelSpan: number,
  ySpanData: number
): boolean {
  const jump = Math.abs(yScale(b.y) - yScale(a.y))
  if (!Number.isFinite(jump) || jump <= yPixelSpan) return false
  if (Math.sign(a.y) === Math.sign(b.y)) return false

  const limit = Math.abs(ySpanData) * POLE_FACTOR
  let lo = a
  let hi = b
  for (let i = 0; i < POLE_BISECTIONS; i++) {
    const x = (lo.x + hi.x) / 2
    const y = fn(x)
    if (!Number.isFinite(y)) return true
    if (Math.abs(y) > limit) return true
    if (Math.sign(y) === Math.sign(lo.y)) lo = { x, y }
    else hi = { x, y }
  }
  return false
}

/**
 * Auto y-window: the 2nd–98th percentile of the finite samples, so one pole
 * can't flatten everything else, padded and biased towards including y = 0.
 */
export function autoYRange(runs: Sample[][], fallback: [number, number] = [-5, 5]): [number, number] {
  const values = runs.flat().map((p) => p.y).filter((y) => Number.isFinite(y)).sort((a, b) => a - b)
  if (values.length < 2) return fallback

  let min = quantile(values, 0.02) ?? values[0]
  let max = quantile(values, 0.98) ?? values[values.length - 1]

  if (!(max > min)) {
    // A constant function: give it room around its value.
    const centre = Number.isFinite(min) ? min : 0
    return [centre - 1, centre + 1]
  }

  const pad = (max - min) * 0.1
  min -= pad
  max += pad

  // Pull in the x-axis when it is close — a graph without y = 0 reads oddly.
  const span = max - min
  if (min > 0 && min < span * 0.25) min = 0
  if (max < 0 && -max < span * 0.25) max = 0

  return [min, max]
}

/** Ramer–Douglas–Peucker on screen coordinates. A parabola drops ~1200 → ~40 points. */
export function simplify(points: Sample[], epsilon = SIMPLIFY_EPSILON): Sample[] {
  if (points.length < 3) return points

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let maxDistance = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicular(points[i], points[start], points[end])
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }
    if (index !== -1 && maxDistance > epsilon) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }

  return points.filter((_, i) => keep[i] === 1)
}

function perpendicular(p: Sample, a: Sample, b: Sample): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length
}
