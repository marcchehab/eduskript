/**
 * Stroke Grouping for Layer Badges
 *
 * Groups nearby strokes from the same canvas layer to display a single badge
 * per cluster rather than one badge per canvas (which would overlap when
 * multiple reference layers are visible).
 *
 * ## Algorithm
 *
 * Uses proximity-based clustering:
 * 1. Each stroke has avgX, avgY (pre-computed average position)
 * 2. Strokes within maxDistance of each other form a group
 * 3. Union-find-like approach: merge groups when strokes are close
 *
 * ## Performance
 *
 * O(n²) worst case where n = number of strokes, but with early exit
 * when distance > maxDistance. Typically n < 50 strokes, so this is fine.
 * For larger annotation sets, consider spatial indexing (quadtree).
 *
 * @see layer-badges.tsx - Consumer of this utility
 * @see simple-canvas.tsx - Where avgX/avgY are computed
 */

export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface StrokeGroup {
  id: string              // Stable ID based on first stroke in group
  bounds: BoundingBox     // Combined bounding box of all strokes
  center: { x: number; y: number }  // Center of the group (for badge positioning)
  strokeCount: number     // Number of strokes in this group
}

interface StrokeWithAvg {
  id: string
  points: Array<{ x: number; y: number; pressure: number }>
  avgX?: number
  avgY?: number
}

/**
 * Computes average position for a stroke (for backward compat with old strokes missing avgX/avgY)
 */
export function getStrokeAvg(stroke: StrokeWithAvg): { x: number; y: number } {
  if (stroke.avgX !== undefined && stroke.avgY !== undefined) {
    return { x: stroke.avgX, y: stroke.avgY }
  }

  // Compute on-the-fly for old strokes
  if (stroke.points.length === 0) {
    return { x: 0, y: 0 }
  }

  let sumX = 0, sumY = 0
  for (const pt of stroke.points) {
    sumX += pt.x
    sumY += pt.y
  }
  return {
    x: sumX / stroke.points.length,
    y: sumY / stroke.points.length
  }
}

/**
 * Calculates bounding box for a stroke
 */
export function calculateStrokeBounds(stroke: StrokeWithAvg): BoundingBox {
  if (stroke.points.length === 0) {
    const avg = getStrokeAvg(stroke)
    return { minX: avg.x, minY: avg.y, maxX: avg.x, maxY: avg.y }
  }

  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity

  for (const pt of stroke.points) {
    if (pt.x < minX) minX = pt.x
    if (pt.y < minY) minY = pt.y
    if (pt.x > maxX) maxX = pt.x
    if (pt.y > maxY) maxY = pt.y
  }

  return { minX, minY, maxX, maxY }
}

/**
 * Merges two bounding boxes
 */
function mergeBounds(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  }
}

/**
 * Distance between two points
 */
function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Groups strokes by proximity using their average positions
 *
 * @param canvasData - JSON stringified array of strokes
 * @param maxDistance - Maximum distance between stroke centers to be in same group (default: 150px)
 * @returns Array of stroke groups
 */
export function groupStrokes(
  canvasData: string,
  maxDistance: number = 150
): StrokeGroup[] {
  let strokes: StrokeWithAvg[]
  try {
    strokes = JSON.parse(canvasData)
  } catch {
    return []
  }

  // Filter out erase strokes
  strokes = strokes.filter(s => (s as { mode?: string }).mode !== 'erase')

  if (strokes.length === 0) {
    return []
  }

  // Pre-compute average positions and bounds for all strokes
  const strokeData = strokes.map((stroke, index) => ({
    index,
    stroke,
    avg: getStrokeAvg(stroke),
    bounds: calculateStrokeBounds(stroke)
  }))

  // Union-Find structure to track which group each stroke belongs to
  const parent: number[] = strokeData.map((_, i) => i)

  function find(i: number): number {
    if (parent[i] !== i) {
      parent[i] = find(parent[i])  // Path compression
    }
    return parent[i]
  }

  function union(i: number, j: number): void {
    const pi = find(i)
    const pj = find(j)
    if (pi !== pj) {
      parent[pi] = pj
    }
  }

  // Group strokes that are close to each other
  for (let i = 0; i < strokeData.length; i++) {
    for (let j = i + 1; j < strokeData.length; j++) {
      const dist = pointDistance(strokeData[i].avg, strokeData[j].avg)
      if (dist <= maxDistance) {
        union(i, j)
      }
    }
  }

  // Collect strokes by group
  const groups = new Map<number, number[]>()
  for (let i = 0; i < strokeData.length; i++) {
    const root = find(i)
    if (!groups.has(root)) {
      groups.set(root, [])
    }
    groups.get(root)!.push(i)
  }

  // Build final group objects
  const result: StrokeGroup[] = []
  for (const [, indices] of groups) {
    // Merge bounds of all strokes in this group
    let combinedBounds = strokeData[indices[0]].bounds
    for (let i = 1; i < indices.length; i++) {
      combinedBounds = mergeBounds(combinedBounds, strokeData[indices[i]].bounds)
    }

    // Use first stroke's ID as group ID (stable identifier)
    const firstStroke = strokeData[indices[0]].stroke

    // Calculate group center from combined bounds
    const center = {
      x: (combinedBounds.minX + combinedBounds.maxX) / 2,
      y: (combinedBounds.minY + combinedBounds.maxY) / 2
    }

    result.push({
      id: firstStroke.id || `group-${indices[0]}`,
      bounds: combinedBounds,
      center,
      strokeCount: indices.length
    })
  }

  // Sort groups by Y position (top to bottom) for consistent ordering
  result.sort((a, b) => a.bounds.minY - b.bounds.minY)

  return result
}
