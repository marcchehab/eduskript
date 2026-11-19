export type SpacerPattern = 'blank' | 'checkered' | 'lines' | 'dots'

/**
 * A student-inserted gap between two content blocks.
 *
 * Placement (see src/lib/annotations/spacer-anchor.ts):
 * - Spacers created since 2026-11-19 carry `anchorSectionId` +
 *   `anchorBlockOffset` (+ `anchorText`) and are placed by those, so content
 *   the teacher adds in OTHER sections no longer moves them.
 * - Older spacers have only `afterBlockIndex` and are placed exactly as before.
 * `afterBlockIndex` is still written for new spacers (fallback when the anchor
 * section is gone, and for clients that predate the anchor fields).
 */
export interface Spacer {
  id: string
  afterBlockIndex: number   // Insert after the Nth content block (spacer-anchor.ts blockChildren)
  height: number            // Pixel height (user-adjustable)
  pattern: SpacerPattern
  /** data-section-id of the nearest block at or above the target block that has one ('' = none, count from the first block). */
  anchorSectionId?: string
  /** Target block = anchor block + this many blocks. */
  anchorBlockOffset?: number
  /** First 60 chars of the target block's text (whitespace collapsed); used to re-find the block when content was inserted inside the same section. */
  anchorText?: string
}
