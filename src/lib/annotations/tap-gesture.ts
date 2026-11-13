/**
 * Multi-finger taps on the paper in stylus mode: two fingers = undo, three
 * fingers = redo (annotation-layer.tsx feeds the document touch events in).
 *
 * A gesture runs from the first finger down to the last finger up. It is a
 * tap when it is short (TAP_MAX_MS), no finger moved more than TAP_MAX_MOVE
 * (a pinch or scroll moves) and the pen did not touch the screen during it
 * (a resting palm while writing). The highest number of fingers down at the
 * same time decides the action. Apple Pencil touches (touchType 'stylus')
 * are not counted; the caller filters them.
 *
 * Known limitation: iPadOS has its own three-finger gestures; whether Safari
 * passes a three-finger tap to the page depends on the device settings.
 */

export const TAP_MAX_MS = 350
export const TAP_MAX_MOVE = 15

export interface TouchPoint {
  id: number
  x: number
  y: number
}

export interface TapGesture {
  startedAt: number
  maxTouches: number
  origins: Map<number, { x: number; y: number }>
  moved: boolean
}

export type TapAction = 'undo' | 'redo'

/** Fingers went down. `touches`: all fingers now down. */
export function tapTouchStart(gesture: TapGesture | null, touches: TouchPoint[], now: number): TapGesture {
  const g = gesture ?? { startedAt: now, maxTouches: 0, origins: new Map(), moved: false }
  for (const t of touches) if (!g.origins.has(t.id)) g.origins.set(t.id, { x: t.x, y: t.y })
  g.maxTouches = Math.max(g.maxTouches, touches.length)
  return g
}

/** Fingers moved. */
export function tapTouchMove(gesture: TapGesture | null, touches: TouchPoint[]): void {
  if (!gesture) return
  for (const t of touches) {
    const o = gesture.origins.get(t.id)
    if (o && Math.hypot(t.x - o.x, t.y - o.y) > TAP_MAX_MOVE) gesture.moved = true
  }
}

/**
 * Fingers went up; `remaining` = fingers still down. When the last one is up
 * the gesture ends: returns the action (or null) and gesture null.
 * `lastPenContactAt`: time the pen last touched the screen.
 */
export function tapTouchEnd(
  gesture: TapGesture | null,
  remaining: number,
  now: number,
  lastPenContactAt: number,
): { gesture: TapGesture | null; action: TapAction | null } {
  if (!gesture) return { gesture: null, action: null }
  if (remaining > 0) return { gesture, action: null }
  const isTap = !gesture.moved && now - gesture.startedAt <= TAP_MAX_MS && lastPenContactAt < gesture.startedAt
  const action = !isTap ? null : gesture.maxTouches === 2 ? 'undo' : gesture.maxTouches === 3 ? 'redo' : null
  return { gesture: null, action }
}

/** Undo/redo stacks of annotation states (the stroke JSON). */
export interface StrokeHistory {
  undo: string[]
  redo: string[]
}

export const HISTORY_LIMIT = 50

/** A local edit changed `before` to `after`. */
export function recordEdit(h: StrokeHistory, before: string, after: string): void {
  if (before === after) return
  h.undo.push(before)
  if (h.undo.length > HISTORY_LIMIT) h.undo.shift()
  h.redo = []
}

/** The state to go back/forward to from `current`, or null. */
export function stepHistory(h: StrokeHistory, action: TapAction, current: string): string | null {
  const from = action === 'undo' ? h.undo : h.redo
  const to = action === 'undo' ? h.redo : h.undo
  const data = from.pop()
  if (data === undefined) return null
  to.push(current)
  return data
}
