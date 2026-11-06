import { describe, it, expect } from 'vitest'
import { isHighlighterStroke, strokeOutline } from '@/lib/annotations/svg-path'

// A horizontal stroke with strongly varying pressure: a pen thins/thickens
// with it, a highlighter must stay constant width.
const points = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 100, pressure: i % 2 ? 0.1 : 1 }))

/** Vertical extent of the outline across its middle part (x 50..150). */
function midHeights(outline: number[][]): number {
  const ys = outline.filter(([x]) => x > 50 && x < 150).map(([, y]) => y)
  return Math.max(...ys) - Math.min(...ys)
}

describe('svg-path — highlighter strokes', () => {
  it('isHighlighterStroke only matches tool "highlighter"', () => {
    expect(isHighlighterStroke({ tool: 'highlighter' })).toBe(true)
    expect(isHighlighterStroke({})).toBe(false)
    expect(isHighlighterStroke({ tool: 'pen' })).toBe(false)
  })

  it('a highlighter outline is the full width (2 × radius), independent of pressure', () => {
    const outline = strokeOutline(points, 10, 'highlighter')
    expect(outline.length).toBeGreaterThan(4)
    // Constant width 20: the outline's band around y=100 spans ~20px.
    expect(midHeights(outline)).toBeGreaterThan(19)
    expect(midHeights(outline)).toBeLessThan(21)
  })

  it('a pen outline with the same radius follows pressure (not constant width)', () => {
    const pen = strokeOutline(points, 10)
    expect(Math.abs(midHeights(pen) - 20)).toBeGreaterThan(2)
  })

  it('dx/dy translate the outline', () => {
    const a = strokeOutline(points, 10, 'highlighter')
    const b = strokeOutline(points, 10, 'highlighter', true, 5, -7)
    expect(b[0][0]).toBeCloseTo(a[0][0] + 5)
    expect(b[0][1]).toBeCloseTo(a[0][1] - 7)
  })
})
