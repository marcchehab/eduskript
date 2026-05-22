/**
 * Section detection utility.
 *
 * Strokes, snaps, and sticky-notes are now portaled into their anchor section
 * via `[data-section-id]` and follow the section through the browser's own
 * layout engine — no JS reposition pass, no persisted-delta updates. The old
 * `repositionStrokes` / `repositionSnaps` / `repositionStickyNote` helpers and
 * the per-record `headingOffsets` / `sectionOffsetY` math they consumed are
 * gone (commit history if anyone needs to dig them up). What remains is the
 * section-detection helper that the draw / drag handlers use to stamp a
 * `sectionId` onto newly placed content, plus the `HeadingPosition` shape they
 * pass around.
 *
 * Filename is left as `reposition-strokes.ts` because every importer still
 * deep-links to that path; rename in a follow-up if you want.
 *
 * @see section-anchored-strokes.tsx - The per-section portal renderer that
 *      replaced the legacy reposition logic.
 */

export interface HeadingPosition {
  sectionId: string
  offsetY: number
  headingText: string
}

/**
 * Returns the sectionId of the last heading whose offsetY is <= y, or null
 * when y falls above the first heading.
 */
export function determineSectionFromY(
  y: number,
  headingPositions: HeadingPosition[],
): string | null {
  if (headingPositions.length === 0) return null

  const sorted = [...headingPositions].sort((a, b) => a.offsetY - b.offsetY)

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (y >= sorted[i].offsetY) {
      return sorted[i].sectionId
    }
  }

  return null
}

/**
 * Visual y-shift that maps a stored stroke onto where the section-anchored SVG
 * renders it *right now*. The SVG renderer carries each stroke with its
 * `[data-section-id]` host through reflow (added content, opened callout, …).
 * Consumers that work off the stored paper coordinates instead — the eraser
 * hit-test and the active-layer badge — keep pointing at the pre-reflow spot
 * unless they add this shift.
 *
 * shift = liveSectionTop − storedSectionOffsetY, where liveSectionTop is the
 * section's current offset from `headingPositions`. Returns 0 when the section
 * isn't in `headingPositions` (orphan, or not measured yet) — i.e. leave it at
 * the stored coords, matching the orphan-fallback layer. The `unknown` →
 * `paper-top` remap mirrors section-anchored-strokes.tsx so legacy strokes
 * resolve to the same live anchor the SVG uses.
 */
export function liveSectionYShift(
  sectionId: string | undefined,
  storedSectionOffsetY: number | undefined,
  headingPositions: HeadingPosition[],
): number {
  if (!sectionId || storedSectionOffsetY === undefined) return 0
  const sid = sectionId === 'unknown' ? 'paper-top' : sectionId
  const live = headingPositions.find(h => h.sectionId === sid)
  if (!live) return 0
  return live.offsetY - storedSectionOffsetY
}

interface RepositionableStroke {
  points: Array<{ x: number; y: number; pressure?: number }>
  sectionId?: string
  sectionOffsetY?: number
  avgY?: number
  [key: string]: unknown
}

/**
 * Returns `canvasData` with every stroke's points (and `avgY`) shifted to its
 * live visual paper-y via {@link liveSectionYShift}. Used to feed paper-coord
 * consumers (the active-layer badge grouping) the same positions the SVG layer
 * paints, so labels track content reflow instead of sticking to the draw-time
 * position. Stored data is never mutated — this produces a throwaway string for
 * display/measurement only. Returns the input unchanged when nothing shifts.
 */
export function repositionCanvasDataToLive(
  canvasData: string,
  headingPositions: HeadingPosition[],
): string {
  if (!canvasData || headingPositions.length === 0) return canvasData
  let strokes: RepositionableStroke[]
  try {
    strokes = JSON.parse(canvasData)
  } catch {
    return canvasData
  }
  if (!Array.isArray(strokes)) return canvasData

  let changed = false
  const next = strokes.map((s) => {
    const shift = liveSectionYShift(s.sectionId, s.sectionOffsetY, headingPositions)
    if (shift === 0) return s
    changed = true
    return {
      ...s,
      points: s.points.map((p) => ({ ...p, y: p.y + shift })),
      avgY: s.avgY !== undefined ? s.avgY + shift : s.avgY,
    }
  })

  return changed ? JSON.stringify(next) : canvasData
}
