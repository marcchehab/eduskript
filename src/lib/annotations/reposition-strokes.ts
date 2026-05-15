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
