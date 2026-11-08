import { describe, it, expect, vi } from 'vitest'
import {
  liveSectionYShift,
  measureHeadingPositions,
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

describe('measureHeadingPositions', () => {
  /** Element whose getBoundingClientRect reports the given top/bottom. */
  const el = (attrs: Record<string, string>, top: number, bottom: number) => {
    const div = document.createElement('div')
    for (const [k, v] of Object.entries(attrs)) div.setAttribute(k, v)
    vi.spyOn(div, 'getBoundingClientRect').mockReturnValue({
      top, bottom, left: 0, right: 0, x: 0, y: top, width: 0, height: bottom - top,
      toJSON: () => ({}),
    } as DOMRect)
    return div
  }

  // Layout of a foldable `> [!tip]-` callout as rendered: the blockquote ends at
  // y=380 (border-box), its 20 px bottom margin follows, and the rehype end
  // sentinel sits after the margin at y=400. The stroke renderer and the
  // draw-commit measurement both anchor `callout-5-end` strokes to that
  // sentinel.
  const foldableCalloutPage = () => {
    const root = document.createElement('div')
    root.append(
      el({ 'data-section-id': 'callout-5', 'data-dynamic-height': 'true' }, 300, 380),
      el({ 'data-section-id': 'callout-5-end', 'data-section-end': 'true' }, 400, 400),
      el({ 'data-section-id': 'h2-next', 'data-heading-text': 'Next' }, 600, 640),
    )
    return root
  }

  it('measures every section relative to the origin, unscaled', () => {
    const positions = measureHeadingPositions(foldableCalloutPage(), 100, 2)
    expect(positions.find(p => p.sectionId === 'h2-next')).toEqual({
      sectionId: 'h2-next', offsetY: 250, headingText: 'Next',
    })
  })

  it('does not shadow a real end sentinel with a synthetic rect.bottom entry', () => {
    // Regression (bruchterme/polynomdivision): a synthetic `callout-5-end` at the
    // callout's border-box bottom (y=380) came first in the list, so
    // liveSectionYShift resolved to it while the stroke renders at the sentinel
    // (y=400) — the eraser hit strokes 20 px below its circle.
    const positions = measureHeadingPositions(foldableCalloutPage(), 0, 1)
    const ends = positions.filter(p => p.sectionId === 'callout-5-end')
    expect(ends).toEqual([{ sectionId: 'callout-5-end', offsetY: 400, headingText: '' }])

    // A stroke committed below the callout stores the sentinel's live top as
    // its sectionOffsetY; with nothing moved, the eraser shift must be 0.
    expect(liveSectionYShift('callout-5-end', 400, positions)).toBe(0)
  })

  it('still synthesizes the bottom edge when no DOM sentinel exists', () => {
    const root = document.createElement('div')
    root.append(el({ 'data-section-id': 'editor-0', 'data-dynamic-height': 'true' }, 50, 250))
    expect(measureHeadingPositions(root, 0, 1).map(p => [p.sectionId, p.offsetY])).toEqual([
      ['editor-0', 50],
      ['editor-0-end', 250],
    ])
  })
})
