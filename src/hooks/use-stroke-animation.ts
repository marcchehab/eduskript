'use client'

/**
 * Utilities for parsing and managing stroke data with stable IDs
 * Used by the CSS overlay animation approach in annotation-layer.tsx
 */

// Stroke data structure (matching simple-canvas.tsx)
export interface AnimatedStroke {
  id: string
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
  sectionId: string
  sectionOffsetY: number
  /** 'highlighter' for highlighter strokes; absent = pen. See svg-path.ts. */
  tool?: 'highlighter'
}

/**
 * Generate a stable content-based ID for a stroke without an ID.
 * Uses stroke characteristics that don't depend on array position.
 */
function generateStableId(stroke: Omit<AnimatedStroke, 'id'>): string {
  const points = stroke.points || []
  const first = points[0]
  const last = points[points.length - 1]

  // Create fingerprint from: first point, last point, count, color, width
  const parts = [
    first ? `${first.x.toFixed(1)},${first.y.toFixed(1)}` : '0,0',
    last ? `${last.x.toFixed(1)},${last.y.toFixed(1)}` : '0,0',
    points.length,
    stroke.color || 'black',
    stroke.width || 2,
    stroke.sectionId || 'unknown'
  ]

  return `stroke-${parts.join('-')}`
}

/**
 * Parse stroke data from JSON string
 * Ensures all strokes have IDs (backward compatibility)
 */
export function parseStrokes(data: string | null | undefined): AnimatedStroke[] {
  if (!data || data === '[]') return []

  try {
    const strokes = JSON.parse(data) as AnimatedStroke[]
    // Ensure all strokes have stable IDs based on content
    return strokes.map((stroke) => ({
      ...stroke,
      id: stroke.id || generateStableId(stroke)
    }))
  } catch {
    return []
  }
}
