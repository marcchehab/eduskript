import { describe, it, expect } from 'vitest'
import {
  liveSectionYShift,
  repositionCanvasDataToLive,
  type HeadingPosition,
} from '@/lib/annotations/reposition-strokes'

const hp = (entries: Array<[string, number]>): HeadingPosition[] =>
  entries.map(([sectionId, offsetY]) => ({ sectionId, offsetY, headingText: '' }))

describe('liveSectionYShift', () => {
  it('returns the delta between the live section top and the stored offset', () => {
    // Section was at y=100 when drawn; content above pushed it to y=160.
    const shift = liveSectionYShift('sec-a', 100, hp([['sec-a', 160]]))
    expect(shift).toBe(60)
  })

  it('is 0 when the section has not moved', () => {
    expect(liveSectionYShift('sec-a', 100, hp([['sec-a', 100]]))).toBe(0)
  })

  it('returns a negative shift when content above was removed', () => {
    expect(liveSectionYShift('sec-a', 200, hp([['sec-a', 140]]))).toBe(-60)
  })

  it('remaps the legacy "unknown" anchor to paper-top (matches the SVG renderer)', () => {
    expect(liveSectionYShift('unknown', 0, hp([['paper-top', 24]]))).toBe(24)
  })

  it('returns 0 for an orphan section absent from headingPositions', () => {
    expect(liveSectionYShift('gone', 100, hp([['sec-a', 160]]))).toBe(0)
  })

  it('returns 0 when sectionId or storedOffset is missing', () => {
    expect(liveSectionYShift(undefined, 100, hp([['sec-a', 160]]))).toBe(0)
    expect(liveSectionYShift('sec-a', undefined, hp([['sec-a', 160]]))).toBe(0)
  })
})

describe('repositionCanvasDataToLive', () => {
  const stroke = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    color: '#000',
    width: 2,
    sectionId: 'sec-a',
    sectionOffsetY: 100,
    points: [
      { x: 10, y: 120, pressure: 0.5 },
      { x: 20, y: 140, pressure: 0.5 },
    ],
    avgY: 130,
    ...overrides,
  })

  it('shifts every point and avgY by the section delta', () => {
    const data = JSON.stringify([stroke()])
    const out = JSON.parse(repositionCanvasDataToLive(data, hp([['sec-a', 160]])))
    expect(out[0].points.map((p: { y: number }) => p.y)).toEqual([180, 200]) // +60
    expect(out[0].avgY).toBe(190)
    // x and other fields untouched
    expect(out[0].points[0].x).toBe(10)
    expect(out[0].id).toBe('s1')
  })

  it('returns the input string unchanged when nothing shifts', () => {
    const data = JSON.stringify([stroke()])
    expect(repositionCanvasDataToLive(data, hp([['sec-a', 100]]))).toBe(data)
  })

  it('leaves orphan strokes (unknown section) at their stored coords', () => {
    const data = JSON.stringify([stroke({ sectionId: 'gone' })])
    expect(repositionCanvasDataToLive(data, hp([['sec-a', 160]]))).toBe(data)
  })

  it('handles a stroke without avgY', () => {
    const s = stroke()
    delete (s as { avgY?: number }).avgY
    const out = JSON.parse(repositionCanvasDataToLive(JSON.stringify([s]), hp([['sec-a', 160]])))
    expect(out[0].avgY).toBeUndefined()
    expect(out[0].points[0].y).toBe(180)
  })

  it('returns input unchanged for empty data or empty headingPositions', () => {
    expect(repositionCanvasDataToLive('', hp([['sec-a', 160]]))).toBe('')
    const data = JSON.stringify([stroke()])
    expect(repositionCanvasDataToLive(data, [])).toBe(data)
  })

  it('returns input unchanged on malformed JSON', () => {
    expect(repositionCanvasDataToLive('not json', hp([['sec-a', 160]]))).toBe('not json')
  })
})
