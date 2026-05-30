/**
 * Eraser → highlight bridge. The annotation eraser canvas overlays the page and
 * knows nothing about highlights (prose <mark>s or code-editor decorations),
 * which live in sibling components. Rather than thread callbacks through every
 * layer, the eraser dispatches a window CustomEvent for each sample point along
 * its path; the highlight layers listen and remove any highlight the point
 * touches. Coordinates are viewport (client) pixels so listeners can hit-test
 * directly against getBoundingClientRect().
 */
export const HIGHLIGHT_ERASE_EVENT = 'highlight-erase'

export interface HighlightEraseDetail {
  x: number // client X
  y: number // client Y
  radius: number // hit-test padding around the point, in client px
}

export function emitHighlightErase(x: number, y: number, radius = 12): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<HighlightEraseDetail>(HIGHLIGHT_ERASE_EVENT, {
      detail: { x, y, radius },
    }),
  )
}

/**
 * Fired when the eraser gesture lifts. Mirrors the stroke eraser, which dims
 * marked strokes during the swipe and commits the deletion on pointer-up — the
 * highlight layers dim hit highlights per-point and commit on this event.
 */
export const HIGHLIGHT_ERASE_END_EVENT = 'highlight-erase-end'

export function emitHighlightEraseEnd(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(HIGHLIGHT_ERASE_END_EVENT))
}

/** True when the client point is within `radius` px of the rect. */
export function pointHitsRect(x: number, y: number, r: DOMRect, radius: number): boolean {
  return (
    x >= r.left - radius &&
    x <= r.right + radius &&
    y >= r.top - radius &&
    y <= r.bottom + radius
  )
}
