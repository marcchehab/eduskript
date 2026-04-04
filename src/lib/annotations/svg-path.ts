/**
 * SVG Path Utilities for Annotation Rendering
 *
 * Converts perfect-freehand stroke outlines to SVG path `d` attribute strings.
 * Same quadratic curve logic as getPathFromStroke() in simple-canvas.tsx,
 * but outputs SVG commands instead of Path2D objects.
 *
 * Also centralizes stroke options and collision detection as pure data functions.
 *
 * @see simple-canvas.tsx - Canvas-based drawing (uses Path2D)
 * @see annotation-svg-layer.tsx - SVG rendering consumer
 */

import { getStroke } from 'perfect-freehand'
import type { StrokeOptions } from 'perfect-freehand'
import { createLogger } from '@/lib/logger'

const log = createLogger('annotations:transforms')

export { getStroke }

/**
 * Map stroke width to perfect-freehand options.
 * Width is radius-like; perfect-freehand size is diameter, hence * 2.
 */
export function getStrokeOptions(width: number): StrokeOptions {
  return {
    size: width * 2,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.3,
    simulatePressure: false,
  }
}

/**
 * Convert perfect-freehand outline points to an SVG path `d` attribute string.
 * Uses quadratic curves for smoothness (same approach as Path2D version).
 */
export function getSvgPathFromStroke(outlinePoints: number[][]): string {
  if (outlinePoints.length < 2) return ''

  const [x0, y0] = outlinePoints[0]
  let d = `M ${x0} ${y0}`

  for (let i = 1; i < outlinePoints.length - 1; i++) {
    const [cx, cy] = outlinePoints[i]
    const [nx, ny] = outlinePoints[i + 1]
    d += ` Q ${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`
  }

  const [lx, ly] = outlinePoints[outlinePoints.length - 1]
  d += ` L ${lx} ${ly} Z`

  return d
}

/**
 * Section transform: how much to translate strokes in a given section.
 * Used by AnnotationSvgLayer to apply <g transform> per section group
 * instead of mutating individual stroke point coordinates.
 */
export interface SectionTransform {
  dx: number
  dy: number
}

/**
 * Compute per-section translation deltas from old heading offsets to current positions.
 * Returns a Map<sectionId, {dx, dy}> for use as SVG <g transform="translate(dx,dy)">.
 *
 * This replaces the point-mutation approach in repositionStrokes() for SVG rendering.
 * Strokes whose sectionId isn't found in current headings are omitted (orphaned).
 */
export function computeSectionTransforms(
  oldHeadingOffsets: Record<string, number> | undefined,
  currentHeadingPositions: Array<{ sectionId: string; offsetY: number }>,
  oldPaddingLeft?: number,
  currentPaddingLeft?: number
): Map<string, SectionTransform> {
  const transforms = new Map<string, SectionTransform>()

  if (!oldHeadingOffsets || Object.keys(oldHeadingOffsets).length === 0) {
    return transforms
  }
  if (currentHeadingPositions.length === 0) {
    return transforms
  }

  const deltaX = (currentPaddingLeft !== undefined && oldPaddingLeft !== undefined)
    ? currentPaddingLeft - oldPaddingLeft
    : 0

  // Build lookup for current positions
  const currentMap = new Map(currentHeadingPositions.map(h => [h.sectionId, h.offsetY]))

  // Sort old sections by Y for nearest-neighbor fallback when sections are deleted
  const oldSorted = Object.entries(oldHeadingOffsets).sort((a, b) => a[1] - b[1])

  for (const [sectionId, oldY] of oldSorted) {
    const currentY = currentMap.get(sectionId)
    if (currentY !== undefined) {
      transforms.set(sectionId, { dx: deltaX, dy: currentY - oldY })
      if (currentY - oldY !== 0) log(`${sectionId}: old=${Math.round(oldY)} cur=${Math.round(currentY)} dy=${Math.round(currentY - oldY)}`)
      continue
    }

    // Section was deleted (e.g., plugin removed). Find the nearest old neighbor
    // that still exists in current layout and derive a transform from it.
    // dy = neighborCurrentY - oldY captures the layout shift at this position.
    log(`${sectionId}: DELETED (old=${Math.round(oldY)}), finding neighbor...`)
    let bestDy = 0
    let bestDist = Infinity
    let bestNeighborId = ''
    for (const [neighborId, neighborOldY] of oldSorted) {
      if (neighborId === sectionId) continue
      const neighborCurrentY = currentMap.get(neighborId)
      if (neighborCurrentY === undefined) continue
      const dist = Math.abs(neighborOldY - oldY)
      if (dist < bestDist) {
        bestDist = dist
        bestDy = neighborCurrentY - oldY
        bestNeighborId = neighborId
      }
    }
    if (bestDist < Infinity) {
      log(`  → neighbor=${bestNeighborId} bestDy=${Math.round(bestDy)}`)
      transforms.set(sectionId, { dx: deltaX, dy: bestDy })
    } else {
      log(`  → no surviving neighbor found`)
    }
  }

  return transforms
}

/**
 * Check if a point is near a stroke (for eraser collision detection).
 * Pure data function — no DOM or canvas dependency.
 * O(n) per stroke where n = point count.
 */
export function isPointNearStroke(
  px: number,
  py: number,
  strokePoints: Array<{ x: number; y: number }>,
  threshold: number = 20
): boolean {
  for (let i = 0; i < strokePoints.length - 1; i++) {
    const p1 = strokePoints[i]
    const p2 = strokePoints[i + 1]

    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const lengthSquared = dx * dx + dy * dy

    if (lengthSquared === 0) {
      const dist = Math.sqrt((px - p1.x) ** 2 + (py - p1.y) ** 2)
      if (dist < threshold) return true
    } else {
      const t = Math.max(0, Math.min(1, ((px - p1.x) * dx + (py - p1.y) * dy) / lengthSquared))
      const projX = p1.x + t * dx
      const projY = p1.y + t * dy
      const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
      if (dist < threshold) return true
    }
  }
  return false
}
