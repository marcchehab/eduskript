/**
 * Two-finger tap = undo, three-finger tap = redo (src/lib/annotations/tap-gesture.ts),
 * and the stroke history behind it.
 */

import { describe, it, expect } from 'vitest'
import { HISTORY_LIMIT, recordEdit, stepHistory, tapTouchEnd, tapTouchMove, tapTouchStart, type StrokeHistory, type TouchPoint } from '@/lib/annotations/tap-gesture'

const pt = (id: number, x = 100 * id, y = 100): TouchPoint => ({ id, x, y })

/** Fingers land at t0 (one after another, 20 ms apart), all lift at `upAt`. */
function tap(fingers: number, { upAt = 150, move = 0, penAt = -1 } = {}) {
  let g = null as ReturnType<typeof tapTouchStart> | null
  const down: TouchPoint[] = []
  for (let i = 1; i <= fingers; i++) {
    down.push(pt(i))
    g = tapTouchStart(g, [...down], 1000 + 20 * (i - 1))
  }
  if (move) tapTouchMove(g, down.map((p) => ({ ...p, x: p.x + move })))
  let result = { gesture: g, action: null as 'undo' | 'redo' | null }
  for (let left = fingers - 1; left >= 0; left--) result = tapTouchEnd(result.gesture, left, 1000 + upAt, 1000 + penAt)
  return result
}

describe('tap gesture', () => {
  it('two fingers undo, three redo', () => {
    expect(tap(2).action).toBe('undo')
    expect(tap(3).action).toBe('redo')
  })

  it('ignores one finger, four fingers, slow taps, moves and pen contact', () => {
    expect(tap(1).action).toBeNull()
    expect(tap(4).action).toBeNull()
    expect(tap(2, { upAt: 600 }).action).toBeNull() // held
    expect(tap(2, { move: 40 }).action).toBeNull() // pinch / scroll
    expect(tap(2, { penAt: 50 }).action).toBeNull() // palm while writing
    expect(tap(2, { penAt: -100 }).action).toBe('undo') // pen lifted just before
  })

  it('ends the gesture only when the last finger is up', () => {
    const g = tapTouchStart(null, [pt(1), pt(2)], 0)
    const mid = tapTouchEnd(g, 1, 50, -1)
    expect(mid).toEqual({ gesture: g, action: null })
    expect(tapTouchEnd(mid.gesture, 0, 80, -1)).toEqual({ gesture: null, action: 'undo' })
  })
})

describe('stroke history', () => {
  it('undoes and redoes; a new edit drops the redo states', () => {
    const h: StrokeHistory = { undo: [], redo: [] }
    recordEdit(h, '[]', '[a]')
    recordEdit(h, '[a]', '[a,b]')
    expect(stepHistory(h, 'undo', '[a,b]')).toBe('[a]')
    expect(stepHistory(h, 'undo', '[a]')).toBe('[]')
    expect(stepHistory(h, 'undo', '[]')).toBeNull()
    expect(stepHistory(h, 'redo', '[]')).toBe('[a]')
    recordEdit(h, '[a]', '[a,c]')
    expect(stepHistory(h, 'redo', '[a,c]')).toBeNull()
    expect(stepHistory(h, 'undo', '[a,c]')).toBe('[a]')
  })

  it('keeps at most HISTORY_LIMIT states and skips no-op edits', () => {
    const h: StrokeHistory = { undo: [], redo: [] }
    recordEdit(h, 'x', 'x')
    expect(h.undo).toHaveLength(0)
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) recordEdit(h, String(i), String(i + 1))
    expect(h.undo).toHaveLength(HISTORY_LIMIT)
    expect(h.undo[0]).toBe('10')
  })
})
