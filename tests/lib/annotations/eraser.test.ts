import { describe, it, expect, beforeEach } from 'vitest'
import {
  cutPolyline,
  eraserSamples,
  loadEraserVariant,
  saveEraserVariant,
  splitStrokeAtCircle,
  type ErasePoint,
} from '@/lib/annotations/eraser'

/** Horizontal freehand stroke at y=100 from x=0 to x=200, a point every 10 px,
 *  pressure rising with x so we can check it survives the cut. */
const freehandPoints: ErasePoint[] = Array.from({ length: 21 }, (_, i) => ({
  x: i * 10,
  y: 100,
  pressure: 0.2 + i * 0.03,
}))

const stroke = (points: ErasePoint[], extra: Record<string, unknown> = {}) => ({
  id: 'orig',
  points,
  mode: 'draw' as const,
  color: '#2BB7EE',
  width: 2,
  sectionId: 'sec-a',
  sectionOffsetY: 340,
  avgX: 100,
  avgY: 100,
  ...extra,
})

let n = 0
const makeId = () => `piece-${++n}`
beforeEach(() => {
  n = 0
})

describe('splitStrokeAtCircle', () => {
  it('cuts a stroke in the middle into two pieces ending on the eraser boundary', () => {
    // eraser radius 10 + stroke width 2 → cut radius 12 around (100, 100)
    const pieces = splitStrokeAtCircle(stroke(freehandPoints), 100, 100, 10, makeId)!
    expect(pieces).toHaveLength(2)
    const [left, right] = pieces
    expect(left.points[0].x).toBe(0)
    expect(left.points.at(-1)!.x).toBeCloseTo(88)
    expect(right.points[0].x).toBeCloseTo(112)
    expect(right.points.at(-1)!.x).toBe(200)
    // No point survives inside the cut circle
    for (const p of [...left.points, ...right.points]) {
      expect(Math.hypot(p.x - 100, p.y - 100)).toBeGreaterThanOrEqual(12 - 1e-9)
    }
    expect(left.id).toBe('piece-1')
    expect(right.id).toBe('piece-2')
  })

  it('cuts the end off a stroke', () => {
    const pieces = splitStrokeAtCircle(stroke(freehandPoints), 200, 100, 10, makeId)!
    expect(pieces).toHaveLength(1)
    expect(pieces[0].points[0].x).toBe(0)
    expect(pieces[0].points.at(-1)!.x).toBeCloseTo(188)
  })

  it('removes a stroke entirely when the eraser covers it', () => {
    const tiny = stroke([{ x: 98, y: 100, pressure: 0.5 }, { x: 101, y: 101, pressure: 0.5 }, { x: 103, y: 99, pressure: 0.5 }])
    expect(splitStrokeAtCircle(tiny, 100, 100, 10, makeId)).toEqual([])
  })

  it('returns null for strokes the eraser does not touch', () => {
    expect(splitStrokeAtCircle(stroke(freehandPoints), 100, 140, 10, makeId)).toBeNull()
    // Far away: rejected by the bounding box
    expect(splitStrokeAtCircle(stroke(freehandPoints), 1000, 1000, 10, makeId)).toBeNull()
  })

  it('cuts a straight two-point line in the middle into two straight lines', () => {
    const line = stroke([{ x: 0, y: 50, pressure: 0.5 }, { x: 400, y: 50, pressure: 0.5 }])
    const pieces = splitStrokeAtCircle(line, 200, 50, 10, makeId)!
    expect(pieces).toHaveLength(2)
    expect(pieces[0].points).toHaveLength(2)
    expect(pieces[1].points).toHaveLength(2)
    expect(pieces[0].points[1].x).toBeCloseTo(188)
    expect(pieces[1].points[0].x).toBeCloseTo(212)
    expect(pieces[1].points[1].x).toBe(400)
  })

  it('keeps freehand fragments out of the two-point "editable line" shape', () => {
    // Cut so that only point x=0 plus the entry point remain on the left.
    const pieces = splitStrokeAtCircle(stroke(freehandPoints), 22, 100, 10, makeId)!
    const left = pieces[0]
    expect(left.points[0].x).toBe(0)
    expect(left.points).toHaveLength(3)
  })

  it('preserves pressure and interpolates it at the cut', () => {
    const pieces = splitStrokeAtCircle(stroke(freehandPoints), 100, 100, 10, makeId)!
    const left = pieces[0]
    // Original points keep their exact pressure
    left.points.slice(0, -1).forEach((p, i) => expect(p.pressure).toBe(freehandPoints[i].pressure))
    // Cut point at x=88 lies between x=80 (p 0.44) and x=90 (p 0.47)
    expect(left.points.at(-1)!.pressure).toBeCloseTo(0.44 + 0.8 * 0.03)
  })

  it('keeps every field of the original except id, points and averages', () => {
    const hl = stroke(freehandPoints, { tool: 'highlighter', width: 14, color: 'hsl(50 85% 55%)' })
    const pieces = splitStrokeAtCircle(hl, 100, 100, 10, makeId)!
    expect(pieces).toHaveLength(2)
    for (const piece of pieces) {
      expect(piece.tool).toBe('highlighter')
      expect(piece.width).toBe(14)
      expect(piece.color).toBe('hsl(50 85% 55%)')
      expect(piece.mode).toBe('draw')
      expect(piece.sectionId).toBe('sec-a')
      expect(piece.sectionOffsetY).toBe(340)
      expect(piece.id).not.toBe('orig')
    }
    // Highlighter width widens the cut: 10 + 14 = 24 around x=100
    expect(pieces[0].points.at(-1)!.x).toBeCloseTo(76)
    // Averages are recomputed for the piece
    const left = pieces[0]
    const expectedAvgX = left.points.reduce((s, p) => s + p.x, 0) / left.points.length
    expect(left.avgX).toBeCloseTo(expectedAvgX)
    expect(left.avgY).toBeCloseTo(100)
  })

  it('drops pieces shorter than two points / 1 px', () => {
    // Eraser leaves only a 0.5 px sliver at the start
    const short = stroke([{ x: 0, y: 0, pressure: 0.5 }, { x: 20, y: 0, pressure: 0.5 }, { x: 40, y: 0, pressure: 0.5 }])
    const pieces = splitStrokeAtCircle(short, 12.5, 0, 10, makeId)! // cut radius 12 → [0.5, 24.5]
    expect(pieces).toHaveLength(1)
    expect(pieces[0].points[0].x).toBeCloseTo(24.5)
  })

  it('ignores erase-mode marker strokes', () => {
    expect(splitStrokeAtCircle(stroke(freehandPoints, { mode: 'erase' }), 100, 100, 10, makeId)).toBeNull()
  })
})

describe('cutPolyline', () => {
  it('a single point inside is removed, outside untouched', () => {
    expect(cutPolyline([{ x: 0, y: 0, pressure: 1 }], 0, 0, 5)).toEqual([])
    expect(cutPolyline([{ x: 10, y: 0, pressure: 1 }], 0, 0, 5)).toBeNull()
  })

  it('a segment passing through without points inside is still cut', () => {
    const runs = cutPolyline([{ x: -50, y: 0, pressure: 1 }, { x: 50, y: 0, pressure: 1 }], 0, 0, 5)!
    expect(runs.map(r => r.map(p => Math.round(p.x * 1e6) / 1e6))).toEqual([[-50, -5], [5, 50]])
  })
})

describe('eraserSamples', () => {
  it('fills gaps larger than the step', () => {
    const s = eraserSamples({ x: 0, y: 0 }, { x: 20, y: 0 }, 6)
    expect(s.map(p => p.x)).toEqual([5, 10, 15, 20])
  })

  it('first sample of a gesture is just the position', () => {
    expect(eraserSamples(null, { x: 3, y: 4 }, 6)).toEqual([{ x: 3, y: 4 }])
  })
})

describe('eraser variant storage', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the stroke eraser and remembers the last choice', () => {
    expect(loadEraserVariant()).toBe('stroke')
    saveEraserVariant('point')
    expect(loadEraserVariant()).toBe('point')
    localStorage.setItem('annotation-eraser-variant', 'garbage')
    expect(loadEraserVariant()).toBe('stroke')
  })
})
