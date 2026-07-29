import { describe, it, expect } from 'vitest'
import { recognizeShape, straightenPath, type StrokePoint } from '@/lib/annotations/shape-snap'

const P = (x: number, y: number, pressure = 0.5): StrokePoint => ({ x, y, pressure })

/** A wobbly path between two points — what a hand actually draws. */
function wobblyLine(x0: number, y0: number, x1: number, y1: number, wobble = 2): StrokePoint[] {
  const points: StrokePoint[] = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    points.push(P(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(i) * wobble))
  }
  return points
}

function circle(cx: number, cy: number, r: number, wobble = 0): StrokePoint[] {
  const points: StrokePoint[] = []
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2
    const rr = r + Math.sin(i * 3) * wobble
    points.push(P(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr))
  }
  return points
}

function rectangle(x: number, y: number, w: number, h: number): StrokePoint[] {
  const points: StrokePoint[] = []
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < 10; i++) {
      const t = i / 10
      points.push(P(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    }
  }
  edge(x, y, x + w, y)
  edge(x + w, y, x + w, y + h)
  edge(x + w, y + h, x, y + h)
  edge(x, y + h, x, y)
  points.push(P(x, y))
  return points
}

describe('straightenPath', () => {
  it('reduces a stroke to its start and end', () => {
    const line = straightenPath(wobblyLine(0, 0, 100, 0))
    expect(line).toHaveLength(2)
    expect(line[0]).toMatchObject({ x: 0 })
    expect(line[1].x).toBeCloseTo(100)
  })

  it('gives the result one uniform pressure', () => {
    const line = straightenPath([P(0, 0, 0.1), P(10, 10, 0.9)])
    expect(line[0].pressure).toBeCloseTo(0.5)
    expect(line[1].pressure).toBe(line[0].pressure)
  })

  it('snaps to the 15° grid without changing the length', () => {
    const snapped = straightenPath([P(0, 0), P(100, 10)], true)
    // 5.7° rounds to 0° → horizontal, same length.
    expect(snapped[1].y).toBeCloseTo(0)
    expect(Math.hypot(snapped[1].x, snapped[1].y)).toBeCloseTo(Math.hypot(100, 10))
  })

  it('snaps a near-diagonal to exactly 45°', () => {
    const snapped = straightenPath([P(0, 0), P(100, 92)], true)
    expect(snapped[1].x).toBeCloseTo(snapped[1].y)
  })
})

describe('recognizeShape', () => {
  it('turns a roughly straight stroke into a line', () => {
    const shape = recognizeShape(wobblyLine(0, 0, 200, 40))
    expect(shape?.kind).toBe('line')
    expect(shape?.points).toHaveLength(2)
  })

  it('recognises a closed round stroke as a circle', () => {
    const shape = recognizeShape(circle(100, 100, 50, 3))
    expect(shape?.kind).toBe('circle')
  })

  it('recognises a boxy closed stroke as a rectangle', () => {
    const shape = recognizeShape(rectangle(10, 10, 120, 80))
    expect(shape?.kind).toBe('rect')
  })

  it('leaves genuinely freehand strokes alone', () => {
    // Handwriting: an open, strongly curved squiggle.
    const squiggle: StrokePoint[] = []
    for (let i = 0; i <= 30; i++) {
      squiggle.push(P(i * 4, Math.sin(i / 2) * 40))
    }
    expect(recognizeShape(squiggle)).toBeNull()
  })

  it('ignores dots and very short ticks', () => {
    expect(recognizeShape([P(0, 0), P(1, 1), P(2, 1), P(2, 2)])).toBeNull()
  })
})
