import { describe, it, expect } from 'vitest'
import {
  isEditableLine,
  moveEndpoint,
  moveLine,
  reanchorLine,
  type EditPoint,
} from '@/lib/annotations/line-edit'
import type { HeadingPosition } from '@/lib/annotations/reposition-strokes'

const P = (x: number, y: number): EditPoint => ({ x, y, pressure: 0.5 })

const headings: HeadingPosition[] = [
  { sectionId: 'paper-top', offsetY: 0, headingText: '' },
  { sectionId: 'h2-a', offsetY: 200, headingText: 'A' },
  { sectionId: 'h2-b', offsetY: 600, headingText: 'B' },
]

describe('isEditableLine', () => {
  it('accepts a two-point stroke only', () => {
    expect(isEditableLine({ points: [P(0, 0), P(10, 10)] })).toBe(true)
    expect(isEditableLine({ points: [P(0, 0), P(5, 5), P(10, 10)] })).toBe(false)
    expect(isEditableLine({ points: [P(0, 0)] })).toBe(false)
  })

  it('ignores eraser strokes', () => {
    expect(isEditableLine({ points: [P(0, 0), P(10, 10)], mode: 'erase' })).toBe(false)
  })
})

describe('moveLine', () => {
  it('shifts both ends and keeps pressure', () => {
    const moved = moveLine([P(0, 0), P(10, 20)], 5, -3)
    expect(moved).toEqual([
      { x: 5, y: -3, pressure: 0.5 },
      { x: 15, y: 17, pressure: 0.5 },
    ])
  })
})

describe('moveEndpoint', () => {
  it('moves the grabbed end and leaves the other', () => {
    const moved = moveEndpoint([P(0, 0), P(10, 0)], 1, 40, 30)
    expect(moved[0]).toMatchObject({ x: 0, y: 0 })
    expect(moved[1]).toMatchObject({ x: 40, y: 30 })
  })

  it('refuses to collapse the line to nothing', () => {
    const moved = moveEndpoint([P(0, 0), P(10, 0)], 0, 10, 0)
    expect(Math.hypot(moved[1].x - moved[0].x, moved[1].y - moved[0].y)).toBeGreaterThanOrEqual(4)
  })
})

describe('reanchorLine', () => {
  it('re-anchors to the section the line was dragged into', () => {
    const result = reanchorLine([P(0, 650), P(100, 700)], headings)
    expect(result).toMatchObject({ sectionId: 'h2-b', sectionOffsetY: 600 })
  })

  it('anchors on the first point, like drawing does', () => {
    // Starts in section A, ends in B — must anchor to A.
    const result = reanchorLine([P(0, 250), P(100, 650)], headings)
    expect(result.sectionId).toBe('h2-a')
  })

  it('always reports the new centre', () => {
    const result = reanchorLine([P(0, 0), P(100, 50)], [])
    expect(result).toMatchObject({ avgX: 50, avgY: 25 })
    expect(result.sectionId).toBeUndefined()
  })
})
