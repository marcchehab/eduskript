'use client'

/**
 * Hook for animating stroke opacity changes in broadcast annotations
 *
 * Tracks stroke changes by ID and animates:
 * - New strokes: fade in (opacity 0 → 1)
 * - Deleted strokes: fade out (opacity 1 → 0)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

// Stroke data structure (matching simple-canvas.tsx)
export interface AnimatedStroke {
  id: string
  points: Array<{ x: number; y: number; pressure: number }>
  mode: 'draw' | 'erase'
  color: string
  width: number
  sectionId: string
  sectionOffsetY: number
}

// Easing function for smooth animation
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

interface UseStrokeAnimationResult {
  // Combined strokes (current + fading out) for rendering
  strokesToRender: AnimatedStroke[]
  // Opacity map for all strokes being animated
  opacities: Map<string, number>
  // Whether animation is currently running
  isAnimating: boolean
}

/**
 * Hook to animate stroke opacity changes
 *
 * @param currentStrokes - Current strokes from the data source
 * @param duration - Animation duration in ms (default 200)
 * @returns Object with strokes to render and their opacities
 */
export function useStrokeAnimation(
  currentStrokes: AnimatedStroke[],
  duration: number = 200
): UseStrokeAnimationResult {
  const [opacities, setOpacities] = useState<Map<string, number>>(new Map())
  const [fadingOutStrokes, setFadingOutStrokes] = useState<AnimatedStroke[]>([])
  const [isAnimating, setIsAnimating] = useState(false)

  const prevStrokesRef = useRef<Map<string, AnimatedStroke>>(new Map())
  const animationRef = useRef<number | null>(null)
  const fadingInRef = useRef<Set<string>>(new Set())
  const fadingOutRef = useRef<Map<string, AnimatedStroke>>(new Map())
  const hasInitializedRef = useRef(false)  // Skip animation on first mount

  // Create a stable string key from stroke IDs to detect actual changes
  const strokeIdsKey = currentStrokes.map(s => s.id).sort().join(',')

  // Stable reference for cleanup - only used on unmount
  const cleanupAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [])

  useEffect(() => {
    // Build current stroke map
    const currentMap = new Map(currentStrokes.map(s => [s.id, s]))
    const currentIds = new Set(currentMap.keys())
    const prevIds = new Set(prevStrokesRef.current.keys())

    // Find new strokes (fade in)
    const newIds = new Set<string>()
    currentIds.forEach(id => {
      if (!prevIds.has(id)) {
        newIds.add(id)
      }
    })

    // Find deleted strokes (fade out)
    const deletedStrokes = new Map<string, AnimatedStroke>()
    prevStrokesRef.current.forEach((stroke, id) => {
      if (!currentIds.has(id)) {
        deletedStrokes.set(id, stroke)
      }
    })

    // Update prev strokes ref for next comparison BEFORE starting animation
    prevStrokesRef.current = currentMap

    // Skip animation on first mount - just show strokes immediately
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      return
    }

    // Update refs for animation
    fadingInRef.current = newIds
    fadingOutRef.current = deletedStrokes

    // Start animation if there are changes
    if (newIds.size > 0 || deletedStrokes.size > 0) {
      // Cancel any existing animation
      cleanupAnimation()

      setIsAnimating(true)
      // Only update fadingOutStrokes if there are actually deleted strokes
      if (deletedStrokes.size > 0) {
        setFadingOutStrokes(Array.from(deletedStrokes.values()))
      }

      // IMPORTANT: Set initial opacity to 0 for new strokes IMMEDIATELY (synchronously)
      // This prevents the "pop" where strokes appear at full opacity before animation starts
      const initialOpacities = new Map<string, number>()
      newIds.forEach(id => initialOpacities.set(id, 0))
      deletedStrokes.forEach((_, id) => initialOpacities.set(id, 1))
      setOpacities(initialOpacities)

      const startTime = performance.now()

      const animate = (now: number) => {
        const elapsed = now - startTime
        const progress = Math.max(0, Math.min(elapsed / duration, 1))  // Clamp to [0, 1]
        const eased = easeOutCubic(progress)

        const newOpacities = new Map<string, number>()

        // Fade in: 0 → 1
        fadingInRef.current.forEach(id => {
          newOpacities.set(id, eased)
        })

        // Fade out: 1 → 0
        fadingOutRef.current.forEach((_, id) => {
          newOpacities.set(id, 1 - eased)
        })

        setOpacities(newOpacities)

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate)
        } else {
          // Animation complete - clean up
          setIsAnimating(false)
          setFadingOutStrokes([])
          setOpacities(new Map())
          fadingInRef.current = new Set()
          fadingOutRef.current = new Map()
          animationRef.current = null
        }
      }

      animationRef.current = requestAnimationFrame(animate)
    }
    // NOTE: Don't return cleanup here - we don't want to cancel animation on re-renders
    // The animation will complete naturally or be cancelled by cleanupAnimation() when a new one starts
  }, [strokeIdsKey, duration, cleanupAnimation]) // Use strokeIdsKey instead of currentStrokes

  // Cleanup on unmount
  useEffect(() => {
    return cleanupAnimation
  }, [cleanupAnimation])

  // Combine current strokes with fading out strokes - memoized for stable reference
  const strokesToRender = useMemo(
    () => [...currentStrokes, ...fadingOutStrokes],
    [currentStrokes, fadingOutStrokes]
  )

  return {
    strokesToRender,
    opacities,
    isAnimating
  }
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
