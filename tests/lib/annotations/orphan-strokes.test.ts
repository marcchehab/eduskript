import { describe, it, expect } from 'vitest'
import { reanchorStrokesInPlace, reportableOrphans } from '@/lib/annotations/orphan-strokes'
import type { StrokeData } from '@/lib/indexeddb/annotations'
import type { HeadingPosition } from '@/lib/annotations/reposition-strokes'

const stroke = (id: string, sectionId: string, y: number, sectionOffsetY = 0): StrokeData => ({
  id, sectionId, sectionOffsetY, mode: 'draw', color: '#000', width: 2,
  points: [{ x: 10, y, pressure: 0.5 }, { x: 20, y: y + 5, pressure: 0.5 }],
})

const hp: HeadingPosition[] = [
  { sectionId: 'paper-top', offsetY: 0, headingText: '' },
  { sectionId: 'h2-@a', offsetY: 100, headingText: 'A' },
  { sectionId: 'h2-a', offsetY: 100, headingText: 'A', legacy: true },
  { sectionId: 'callout@h2-@a#1-end', offsetY: 300, headingText: '' },
]

describe('reportableOrphans', () => {
  it('leaves out strokes on spacers that are still in the spacer data', () => {
    const orphans = [stroke('1', 'spacer-abc', 0), stroke('2', 'spacer-abc-end', 0), stroke('3', 'spacer-gone', 0), stroke('4', 'callout-3', 0)]
    expect(reportableOrphans(orphans, new Set(['abc'])).map(s => s.id)).toEqual(['3', '4'])
  })
})

describe('reanchorStrokesInPlace', () => {
  it('anchors only the given strokes to the current section at their y, points unchanged', () => {
    const strokes = [stroke('o1', 'callout-9', 320, 280), stroke('o2', 'h2-removed', 150, 90), stroke('k', 'h2-@a', 120, 100)]
    const out = reanchorStrokesInPlace(strokes, new Set(['o1', 'o2']), hp)
    expect(out[0]).toMatchObject({ sectionId: 'callout@h2-@a#1-end', sectionOffsetY: 300, points: strokes[0].points })
    // Never a legacy alias, even at the same offset.
    expect(out[1]).toMatchObject({ sectionId: 'h2-@a', sectionOffsetY: 100, points: strokes[1].points })
    expect(out[2]).toBe(strokes[2])
    // Rendered y = section offset + (y − sectionOffsetY) = stored y: no visual move.
    for (const s of out.slice(0, 2)) {
      const live = hp.find(h => h.sectionId === s.sectionId)!.offsetY
      expect(live + (s.points[0].y - s.sectionOffsetY)).toBe(s.points[0].y)
    }
  })
})
