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
 * - `avgX`, `avgY`: Average position for quick section lookups
 *
 * On display, we compute the delta between stored and current heading Y,
 * then translate all stroke points by that delta.
 *
 * ## Section Detection
 *
 * Section detection uses stored sectionId first (most reliable), then falls
 * back to avgY-based lookup. This is O(n) where n = number of sections,
 * much faster than the previous O(n*m) majority voting approach.
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
 * @see annotation-layer.tsx - Uses this for teacher→student broadcasts
 * @see simple-canvas.tsx - Records sectionId/sectionOffsetY/avgX/avgY per stroke
 */

export interface StrokeData {
  id: string  // Unique identifier for per-stroke animations
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
  sectionId: string
  sectionOffsetY: number
  avgX?: number  // Average X position of all points (for grouping)
  avgY?: number  // Average Y position of all points (for section detection)
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
 * Determines which section a stroke belongs to using avgY (O(1) lookup)
 * Falls back to stored sectionId if avgY unavailable or section not in old offsets
 *
 * Previous implementation did O(n*m) majority voting across all points - now replaced
 * with simple avgY-based lookup since strokes store their average position.
 */
function findStrokeSection(
  stroke: StrokeData,
  oldHeadingOffsets: Record<string, number>
): string | null {
  // If stroke has a stored sectionId and that section exists in old offsets, use it directly
  // This is the most reliable path - trust what was computed at draw time
  if (stroke.sectionId && stroke.sectionId !== 'unknown' && oldHeadingOffsets[stroke.sectionId] !== undefined) {
    return stroke.sectionId
  }

  // If no old offsets available, trust the stored sectionId even if not in offsets
  if (Object.keys(oldHeadingOffsets).length === 0) {
    return stroke.sectionId
  }

  // Use avgY for section detection (O(n) where n = number of sections)
  // Compute avgY if not stored (backward compat with old strokes)
  let avgY = stroke.avgY
  if (avgY === undefined && stroke.points.length > 0) {
    avgY = stroke.points.reduce((sum, p) => sum + p.y, 0) / stroke.points.length
  }

  if (avgY === undefined) {
    return stroke.sectionId || null
  }

  // Convert old offsets to sorted array
  const oldPositions = Object.entries(oldHeadingOffsets)
    .map(([sectionId, offsetY]) => ({ sectionId, offsetY }))
    .sort((a, b) => a.offsetY - b.offsetY)

  // Find which section contains avgY (last section whose offsetY <= avgY)
  let foundSection: string | null = null
  for (let i = oldPositions.length - 1; i >= 0; i--) {
    if (avgY >= oldPositions[i].offsetY) {
      foundSection = oldPositions[i].sectionId
      break
    }
  }

  // If avgY is before all sections (e.g., annotations above first tracked heading),
  // fall back to stored sectionId
  return foundSection || stroke.sectionId || null
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
    // Determine which section this stroke belongs to
    // Uses stored sectionId when available, falls back to avgY-based lookup
    const strokeSection = findStrokeSection(stroke, oldHeadingOffsets)

    if (!strokeSection || strokeSection === 'unknown') {
      // Stroke has no section association, keep at absolute position
      repositioned.push(stroke)
      return
    }

    // Find current position of the stroke's section
    const currentHeading = currentHeadingPositions.find(h => h.sectionId === strokeSection)

    if (!currentHeading) {
      // Section was deleted - mark as orphaned
      orphanedCount++
      repositioned.push({
        ...stroke,
        sectionId: strokeSection + '-ORPHANED'
      })
      return
    }

    // Get the old position of this section
    const oldOffsetY = oldHeadingOffsets[strokeSection]
    if (oldOffsetY === undefined) {
      // Section exists in current layout but wasn't tracked when saved
      // Use stored sectionOffsetY if available, otherwise keep stroke as-is
      if (stroke.sectionOffsetY !== undefined) {
        const deltaY = currentHeading.offsetY - stroke.sectionOffsetY
        if (deltaY !== 0 || deltaX !== 0) {
          const transformedPoints = stroke.points.map(point => ({
            ...point,
            x: point.x + deltaX,
            y: point.y + deltaY
          }))
          repositioned.push({
            ...stroke,
            points: transformedPoints,
            sectionId: strokeSection,
            sectionOffsetY: currentHeading.offsetY
          })
          return
        }
      }
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
      sectionId: strokeSection,
      sectionOffsetY: currentHeading.offsetY
    })
  })

  return { strokes: repositioned, orphanedCount }
}

/**
 * Snap data for repositioning
 * Includes optional section metadata for reliable vertical repositioning
 */
export interface SnapForReposition {
  id: string
  name: string
  imageUrl: string
  top: number
  left: number // Pixels from left edge of paper
  width: number
  height: number
  sectionId?: string // Section heading ID this snap belongs to
  sectionOffsetY?: number // Y offset of the section when snap was created
}

export interface RepositionSnapsResult {
  snaps: SnapForReposition[]
}

/**
 * Repositions snaps based on new heading positions
 * Uses stored sectionId if available, otherwise determines section from snap's top position
 *
 * Note: snap.left is stored in pixels. Since the paper has a fixed width, horizontal
 * repositioning is not needed. Only vertical repositioning based on section movement.
 */
export function repositionSnaps(
  snaps: SnapForReposition[],
  currentHeadingPositions: HeadingPosition[],
  oldHeadingOffsets: Record<string, number>,
  _currentPaddingLeft?: number, // Kept for API compatibility, but not used
  _oldPaddingLeft?: number      // Left is now percentage-based, no horizontal adjustment needed
): RepositionSnapsResult {
  // Sort old offsets to find sections by position (fallback when sectionId not stored)
  const oldPositions = Object.entries(oldHeadingOffsets)
    .map(([sectionId, offsetY]) => ({ sectionId, offsetY }))
    .sort((a, b) => a.offsetY - b.offsetY)

  const repositioned: SnapForReposition[] = snaps.map(snap => {
    // First, try to use stored sectionId (most reliable)
    let sectionId: string | null = snap.sectionId || null

    // If snap has stored sectionId and it exists in old offsets, use it directly
    if (sectionId && oldHeadingOffsets[sectionId] !== undefined) {
      // sectionId is valid, continue with repositioning
    } else if (sectionId && snap.sectionOffsetY !== undefined) {
      // sectionId exists but not in oldHeadingOffsets - use stored sectionOffsetY
      const currentHeading = currentHeadingPositions.find(h => h.sectionId === sectionId)
      if (!currentHeading) {
        // Section deleted, keep snap as-is
        return snap
      }

      const deltaY = currentHeading.offsetY - snap.sectionOffsetY
      if (deltaY === 0) {
        return snap
      }

      return {
        ...snap,
        top: snap.top + deltaY,
        sectionOffsetY: currentHeading.offsetY, // Update stored offset
      }
    } else {
      // No stored sectionId or it's not in old offsets - fall back to position-based detection
      sectionId = null
      for (let i = oldPositions.length - 1; i >= 0; i--) {
        if (snap.top >= oldPositions[i].offsetY) {
          sectionId = oldPositions[i].sectionId
          break
        }
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
    if (oldOffsetY === undefined) {
      // Section not tracked in old offsets, keep as-is
      return snap
    }

    const deltaY = currentHeading.offsetY - oldOffsetY

    if (deltaY === 0) {
      return snap
    }

    return {
      ...snap,
      top: snap.top + deltaY,
      sectionId, // Store sectionId for future repositioning
      sectionOffsetY: currentHeading.offsetY, // Update stored offset
    }
  })

  return { snaps: repositioned }
}
