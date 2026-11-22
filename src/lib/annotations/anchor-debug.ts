/**
 * Debug view for stroke anchor groups (joinsStrokeGroup in
 * src/components/annotations/simple-canvas.tsx). Active with `?anchordebug`
 * in the page URL: each stroke drawn in this tab is filled with a colour of
 * its group, and the hue says why the group started (the previous stroke was
 * not joined):
 * - red: too late (more than STROKE_GROUP_MAX_GAP_MS after the previous stroke)
 * - blue: in time, but too far from the previous stroke
 * - orange: in time and close, but the group would get too tall
 * - green: no previous stroke (first stroke since page load, or its anchor left the DOM)
 * Consecutive groups of the same reason alternate in shade.
 *
 * The URL is read once per page load. Memory only (stroke id → group, kept
 * only while the view is on), never stored: after a reload the strokes show
 * their real colours. Rendered by section-anchored-strokes.tsx.
 */

export type GroupStart = 'time' | 'distance' | 'height' | 'first'

const HUE: Record<GroupStart, number> = { time: 0, distance: 215, height: 32, first: 130 }

const groups = new Map<string, { group: number; start: GroupStart }>()
let groupCount = 0

let enabled: boolean | undefined

export function anchorDebugEnabled(): boolean {
  if (enabled === undefined) {
    if (typeof window === 'undefined') return false
    enabled = new URLSearchParams(window.location.search).has('anchordebug')
  }
  return enabled
}

/** Opens a new group for the next stroke; returns its number. */
export function startStrokeGroup(): number {
  return ++groupCount
}

export function recordStrokeGroup(strokeId: string, group: number, start: GroupStart): void {
  if (anchorDebugEnabled()) groups.set(strokeId, { group, start })
}

/** Fill colour for a stroke in the debug view, or undefined (not drawn in this tab / debug off). */
export function anchorDebugColor(strokeId: string): string | undefined {
  const g = groups.get(strokeId)
  if (!g) return undefined
  const shade = g.group % 3
  return `hsl(${HUE[g.start] + shade * 12} 85% ${38 + shade * 12}%)`
}
