import { describe, it, expect } from 'vitest'
import {
  deleteStrokes,
  duplicateStrokes,
  findEnclosedStrokes,
  isLassoLoop,
  moveStrokes,
  pointInPolygon,
  selectionBounds,
  type AnchorFor,
  type SelPoint,
} from '@/lib/annotations/selection'
import { determineSectionFromY } from '@/lib/annotations/reposition-strokes'

const pt = (x: number, y: number, pressure = 0.5): SelPoint => ({ x, y, pressure })

/** Closed circle-ish loop of radius r around (cx, cy). */
const loop = (cx: number, cy: number, r: number, n = 32) =>
  Array.from({ length: n + 1 }, (_, i) => pt(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)))

const stroke = (id: string, points: SelPoint[], extra: Record<string, unknown> = {}) => ({
  id,
  points,
  mode: 'draw',
  color: '#000',
  width: 2,
  sectionId: 'sec-a',
  sectionOffsetY: 0,
  ...extra,
})

const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)]

describe('pointInPolygon', () => {
  it('inside / outside a square', () => {
    expect(pointInPolygon(50, 50, square)).toBe(true)
    expect(pointInPolygon(150, 50, square)).toBe(false)
    expect(pointInPolygon(-1, 50, square)).toBe(false)
  })

  it('handles a concave polygon (U shape)', () => {
    const u = [pt(0, 0), pt(30, 0), pt(30, 70), pt(70, 70), pt(70, 0), pt(100, 0), pt(100, 100), pt(0, 100)]
    expect(pointInPolygon(50, 30, u)).toBe(false) // in the notch
    expect(pointInPolygon(15, 30, u)).toBe(true)
    expect(pointInPolygon(50, 85, u)).toBe(true)
  })
})

describe('isLassoLoop', () => {
  it('a closed circle is a lasso', () => {
    expect(isLassoLoop(loop(100, 100, 50))).toBe(true)
  })

  it('a nearly closed loop (small gap) is a lasso', () => {
    expect(isLassoLoop(loop(100, 100, 50).slice(0, -2))).toBe(true)
  })

  it('an open arc or a straight line is not', () => {
    expect(isLassoLoop(loop(100, 100, 50).slice(0, 17))).toBe(false) // half circle
    expect(isLassoLoop(Array.from({ length: 20 }, (_, i) => pt(i * 10, 0)))).toBe(false)
  })

  it('a tiny loop (a dot) is not', () => {
    expect(isLassoLoop(loop(0, 0, 5))).toBe(false)
  })
})

describe('findEnclosedStrokes', () => {
  const inside = stroke('in', [pt(80, 90), pt(100, 100), pt(120, 110)])
  const outside = stroke('out', [pt(300, 300), pt(320, 310)])
  const dipping = stroke('dip', [pt(130, 100), pt(200, 100), pt(260, 100), pt(320, 100), pt(380, 100)])
  const line = stroke('line', [pt(90, 100), pt(260, 100)]) // one end inside, centre 175 outside r=60

  it('finds strokes most of whose points are inside', () => {
    expect(findEnclosedStrokes([inside, outside, dipping, line], loop(100, 100, 60))).toEqual(['in'])
  })

  it('returns nothing when the loop encloses no stroke', () => {
    expect(findEnclosedStrokes([outside, dipping], loop(100, 100, 60))).toEqual([])
  })

  it('a two-point line counts with its centre + one endpoint inside', () => {
    const shortLine = stroke('l2', [pt(70, 100), pt(140, 100)]) // centre 105, endpoint 70 inside r=40
    expect(findEnclosedStrokes([shortLine], loop(100, 100, 40))).toEqual(['l2'])
  })

  it('tests strokes at their live (shifted) position', () => {
    // Stored at y=100, but its section moved down by 200 since it was drawn.
    const moved = stroke('moved', [pt(90, 100), pt(100, 100), pt(110, 100)])
    expect(findEnclosedStrokes([moved], loop(100, 100, 40), () => 200)).toEqual([])
    expect(findEnclosedStrokes([moved], loop(100, 300, 40), () => 200)).toEqual(['moved'])
  })

  it('ignores erase-mode markers', () => {
    expect(findEnclosedStrokes([{ ...inside, mode: 'erase' }], loop(100, 100, 60))).toEqual([])
  })
})

// Sections: sec-a at y=0, sec-b at y=500 (live). anchorFor mimics the layer's
// determineSectionFromY + live measurement.
const headings = [
  { sectionId: 'sec-a', offsetY: 0, headingText: 'A' },
  { sectionId: 'sec-b', offsetY: 500, headingText: 'B' },
]
const anchorFor: AnchorFor = (points) => {
  const sectionId = determineSectionFromY(points[0].y, headings) || 'paper-top'
  return { sectionId, sectionOffsetY: headings.find(h => h.sectionId === sectionId)!.offsetY }
}

describe('moveStrokes', () => {
  it('moves only selected strokes and re-anchors them to the section they land in', () => {
    const a = stroke('a', [pt(10, 100), pt(20, 110)], { tool: 'highlighter', color: '#f00' })
    const b = stroke('b', [pt(10, 200), pt(20, 210)])
    const out = moveStrokes([a, b], new Set(['a']), 5, 450, () => 0, anchorFor)
    expect(out[1]).toBe(b) // untouched: same object
    expect(out[0].points).toEqual([pt(15, 550), pt(25, 560)])
    expect(out[0].sectionId).toBe('sec-b')
    expect(out[0].sectionOffsetY).toBe(500)
    expect(out[0].id).toBe('a')
    expect(out[0].tool).toBe('highlighter')
    expect(out[0].avgX).toBe(20)
    expect(out[0].avgY).toBe(555)
  })

  it('rebases a reflowed stroke to its live position before moving', () => {
    // Drawn when sec-b sat at 300; sec-b is now at 500 → live shift +200.
    const s = stroke('s', [pt(10, 350), pt(20, 360)], { sectionId: 'sec-b', sectionOffsetY: 300 })
    const [moved] = moveStrokes([s], new Set(['s']), 0, 10, () => 200, anchorFor)
    expect(moved.points.map(p => p.y)).toEqual([560, 570])
    expect(moved.sectionId).toBe('sec-b')
    expect(moved.sectionOffsetY).toBe(500)
  })

  it('preview mode (no anchorFor) moves stored coords and keeps the anchor', () => {
    const s = stroke('s', [pt(10, 350)], { sectionId: 'sec-b', sectionOffsetY: 300 })
    const [moved] = moveStrokes([s], new Set(['s']), 0, 10, () => 200, null)
    expect(moved.points[0].y).toBe(360)
    expect(moved.sectionOffsetY).toBe(300)
  })
})

describe('deleteStrokes / duplicateStrokes', () => {
  const a = stroke('a', [pt(10, 100), pt(20, 110)])
  const b = stroke('b', [pt(10, 200), pt(20, 210)])

  it('delete removes exactly the selection', () => {
    expect(deleteStrokes([a, b], new Set(['a'])).map(s => s.id)).toEqual(['b'])
  })

  it('duplicate appends offset copies with new ids and keeps the originals', () => {
    let n = 0
    const { strokes, newIds } = duplicateStrokes([a, b], new Set(['a', 'b']), () => 0, anchorFor, 20, () => `copy-${++n}`)
    expect(strokes.map(s => s.id)).toEqual(['a', 'b', 'copy-1', 'copy-2'])
    expect(newIds).toEqual(['copy-1', 'copy-2'])
    expect(strokes[2].points[0]).toEqual(pt(30, 120))
    expect(strokes[2].color).toBe('#000')
    expect(strokes[2].sectionId).toBe('sec-a')
    expect(strokes[0]).toBe(a)
  })
})

describe('selectionBounds', () => {
  it('live bbox of the selected strokes', () => {
    const a = stroke('a', [pt(10, 100), pt(20, 110)])
    const b = stroke('b', [pt(50, 5), pt(60, 300)])
    expect(selectionBounds([a, b], new Set(['a']), () => 7)).toEqual({ minX: 10, minY: 107, maxX: 20, maxY: 117 })
    expect(selectionBounds([a, b], new Set(['zzz']))).toBeNull()
  })
})
