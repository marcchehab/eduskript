/**
 * Cross-Device Stroke Repositioning
 *
 * When a teacher draws annotations and broadcasts to students, the students'
 * screens may have different dimensions, zoom levels, or responsive breakpoints.
 * This module aligns strokes to the correct content sections.
 *
 * ## How It Works
 *
 * ```
 * Teacher draws at:          Student sees content at:
 * Heading A: y=100           Heading A: y=150  (moved down)
 * Heading B: y=300           Heading B: y=400  (moved down)
 *
 * Stroke in section A        → repositioned by delta (+50)
 * ```
 *
 * Each stroke stores:
 * - `sectionId`: Which heading it belongs to (e.g., "h2-introduction")
 * - `sectionOffsetY`: The Y position of that heading when drawn
 *
 * On display, we compute the delta between stored and current heading Y,
 * then translate all stroke points by that delta.
 *
 * ## Majority Voting
 *
 * A stroke may cross multiple sections. We assign it to whichever section
 * contains the majority of its points. This handles edge cases where users
 * draw across heading boundaries.
 *
 * ## Known Limitations
 *
 * 1. **Section deletion = orphaned strokes**: If a heading is removed from
 *    content, strokes in that section become orphaned. We mark them with
 *    `-ORPHANED` suffix but don't delete them (data preservation).
 *
 * 2. **X-axis repositioning is simple**: We only adjust for padding changes,
 *    not for responsive content reflow. Horizontal content shifts may cause
 *    misalignment.
 *
 * 3. **No sub-section awareness**: If content within a section grows/shrinks,
 *    strokes in that section don't reposition internally. They move as a
 *    block with the section heading.
 *
 * 4. **O(n*m) majority voting**: Each stroke checks all its points against
 *    all sections. For very long strokes (1000+ points), this could be slow.
 *    In practice, most strokes have <100 points.
 *
 * @see annotation-layer.tsx - Uses this for teacher→student broadcasts
 * @see simple-canvas.tsx - Records sectionId/sectionOffsetY per stroke
 */

export interface StrokeData {
  id: string  // Unique identifier for per-stroke animations
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
  sectionId: string
  sectionOffsetY: number
}

export interface HeadingPosition {
  sectionId: string
  offsetY: number
  headingText: string
}

export interface RepositionResult {
  strokes: StrokeData[]
  orphanedCount: number
}

/**
 * Determines which section a stroke belongs to based on majority of points
 * Uses the OLD heading positions (from when stroke was saved) to determine section ownership
 */
function findStrokeMajoritySection(
  stroke: StrokeData,
  oldHeadingOffsets: Record<string, number>
): string | null {
  if (Object.keys(oldHeadingOffsets).length === 0) {
    // No old offsets available, trust the stored sectionId
    return stroke.sectionId
  }

  const sectionCounts = new Map<string, number>()

  // Convert old offsets to sorted array
  const oldPositions = Object.entries(oldHeadingOffsets)
    .map(([sectionId, offsetY]) => ({ sectionId, offsetY }))
    .sort((a, b) => a.offsetY - b.offsetY)

  // Count points in each section using OLD positions
  stroke.points.forEach(point => {
    // Point.y is already in absolute page coordinates
    const absoluteY = point.y

    // Find which section this point was in based on OLD positions
    let sectionId: string | null = null
    for (let i = oldPositions.length - 1; i >= 0; i--) {
      if (absoluteY >= oldPositions[i].offsetY) {
        sectionId = oldPositions[i].sectionId
        break
      }
    }

    if (sectionId) {
      sectionCounts.set(sectionId, (sectionCounts.get(sectionId) || 0) + 1)
    }
  })

  // Find section with most points
  let maxCount = 0
  let majoritySection: string | null = null

  sectionCounts.forEach((count, sectionId) => {
    if (count > maxCount) {
      maxCount = count
      majoritySection = sectionId
    }
  })

  return majoritySection
}

/**
 * Helper function to determine which section contains a given Y coordinate
 */
export function determineSectionFromY(
  y: number,
  headingPositions: HeadingPosition[]
): string | null {
  if (headingPositions.length === 0) return null

  // Sort headings by offsetY
  const sorted = [...headingPositions].sort((a, b) => a.offsetY - b.offsetY)

  // Find the section containing this Y coordinate
  // (the last heading whose offsetY is <= y)
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (y >= sorted[i].offsetY) {
      return sorted[i].sectionId
    }
  }

  // If Y is before all headings, return null
  return null
}

/**
 * Repositions strokes based on new heading positions and padding changes
 * Returns repositioned strokes and count of orphaned strokes
 */
export function repositionStrokes(
  strokes: StrokeData[],
  currentHeadingPositions: HeadingPosition[],
  oldHeadingOffsets: Record<string, number>,
  currentPaddingLeft?: number,
  oldPaddingLeft?: number
): RepositionResult {
  // Calculate horizontal delta from padding change
  const deltaX = (currentPaddingLeft !== undefined && oldPaddingLeft !== undefined)
    ? currentPaddingLeft - oldPaddingLeft
    : 0
  const repositioned: StrokeData[] = []
  let orphanedCount = 0

  strokes.forEach(stroke => {
    // Determine which section this stroke ACTUALLY belongs to
    // by checking where the majority of its points are using OLD positions
    const majoritySection = findStrokeMajoritySection(stroke, oldHeadingOffsets)

    if (!majoritySection || majoritySection === 'unknown') {
      // Stroke has no section association, keep at absolute position
      repositioned.push(stroke)
      return
    }

    // Find current position of the majority section
    const currentHeading = currentHeadingPositions.find(h => h.sectionId === majoritySection)

    if (!currentHeading) {
      // Section was deleted - mark as orphaned
      orphanedCount++
      repositioned.push({
        ...stroke,
        sectionId: majoritySection + '-ORPHANED'
      })
      return
    }

    // Get the old position of this section
    const oldOffsetY = oldHeadingOffsets[majoritySection]
    if (oldOffsetY === undefined) {
      // No old offset data, keep stroke as-is
      repositioned.push(stroke)
      return
    }

    // Calculate offset delta (how much the section moved vertically)
    const deltaY = currentHeading.offsetY - oldOffsetY

    // If no movement needed (both X and Y), keep stroke as-is
    if (deltaY === 0 && deltaX === 0) {
      repositioned.push(stroke)
      return
    }

    // Transform all points by the deltas
    const transformedPoints = stroke.points.map(point => ({
      ...point,
      x: point.x + deltaX,
      y: point.y + deltaY
    }))

    // Update stroke with new data
    repositioned.push({
      ...stroke,
      points: transformedPoints,
      sectionId: majoritySection,
      sectionOffsetY: currentHeading.offsetY
    })
  })

  return { strokes: repositioned, orphanedCount }
}

/**
 * Basic snap data for repositioning (no section metadata needed)
 */
export interface SnapForReposition {
  id: string
  name: string
  imageUrl: string
  top: number
  left: number
  width: number
  height: number
}

export interface RepositionSnapsResult {
  snaps: SnapForReposition[]
}

/**
 * Repositions snaps based on new heading positions and padding changes
 * Determines section membership at runtime from snap's top position
 */
export function repositionSnaps(
  snaps: SnapForReposition[],
  currentHeadingPositions: HeadingPosition[],
  oldHeadingOffsets: Record<string, number>,
  currentPaddingLeft?: number,
  oldPaddingLeft?: number
): RepositionSnapsResult {
  const deltaX = (currentPaddingLeft !== undefined && oldPaddingLeft !== undefined)
    ? currentPaddingLeft - oldPaddingLeft
    : 0

  // Sort old offsets to find sections by position
  const oldPositions = Object.entries(oldHeadingOffsets)
    .map(([sectionId, offsetY]) => ({ sectionId, offsetY }))
    .sort((a, b) => a.offsetY - b.offsetY)

  const repositioned: SnapForReposition[] = snaps.map(snap => {
    // Determine section from snap's top position using OLD heading positions
    let sectionId: string | null = null
    for (let i = oldPositions.length - 1; i >= 0; i--) {
      if (snap.top >= oldPositions[i].offsetY) {
        sectionId = oldPositions[i].sectionId
        break
      }
    }

    if (!sectionId) {
      // Snap is above all headings, keep as-is
      return snap
    }

    // Find current position of this section
    const currentHeading = currentHeadingPositions.find(h => h.sectionId === sectionId)
    if (!currentHeading) {
      // Section deleted, keep as-is
      return snap
    }

    const oldOffsetY = oldHeadingOffsets[sectionId]
    const deltaY = currentHeading.offsetY - oldOffsetY

    if (deltaY === 0 && deltaX === 0) {
      return snap
    }

    return {
      ...snap,
      top: snap.top + deltaY,
      left: snap.left + deltaX,
    }
  })

  return { snaps: repositioned }
}
