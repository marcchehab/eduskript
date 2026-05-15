/**
 * SVG Annotation Layer — flat-render fallback.
 *
 * Renders committed annotation strokes as SVG <path> elements at their stored
 * paper-absolute coordinates. Used only by the orphan-fallback path in
 * annotation-layer.tsx (strokes whose sectionId doesn't resolve to a live DOM
 * element). All other rendering — active drawing and reference layers — goes
 * through SectionAnchoredStrokes, which portals SVGs per-section so the
 * browser carries them through reflow without any JS reposition.
 *
 * @see svg-path.ts - SVG path conversion
 * @see section-anchored-strokes.tsx - The main render path
 * @see simple-canvas.tsx - Viewport canvas for active drawing
 */

'use client'

import { memo, useMemo } from 'react'
import { getStroke } from 'perfect-freehand'
import { getSvgPathFromStroke, getStrokeOptions, hasUniformPressure, smoothPoints } from '@/lib/annotations/svg-path'
import type { AnimatedStroke } from '@/hooks/use-stroke-animation'

interface AnnotationSvgLayerProps {
  strokes: AnimatedStroke[]
  width: number            // paper width (viewBox)
  height: number           // paper height (viewBox)
  markedForDeletion?: Set<string>  // stroke IDs at 0.3 opacity (eraser preview)
  className?: string
}

interface PathDatum {
  id: string
  d: string
  color: string
}

export const AnnotationSvgLayer = memo(function AnnotationSvgLayer({
  strokes,
  width,
  height,
  markedForDeletion,
  className = '',
}: AnnotationSvgLayerProps) {
  const pathData = useMemo(() => {
    return strokes
      .filter(s => s.mode !== 'erase' && s.points.length >= 2)
      .map((stroke): PathDatum => {
        const isUniform = hasUniformPressure(stroke.points)
        const sourcePoints = isUniform ? smoothPoints(stroke.points) : stroke.points
        const inputPoints = sourcePoints.map(p => [p.x, p.y, p.pressure])
        const outline = getStroke(inputPoints, getStrokeOptions(stroke.width, true, isUniform))
        const d = getSvgPathFromStroke(outline)
        return {
          id: stroke.id,
          d,
          color: stroke.color,
        }
      })
  }, [strokes])

  if (pathData.length === 0) return null

  return (
    <svg
      className={`annotation-svg ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: `${height}px`,
        pointerEvents: 'none',
      }}
    >
      {pathData.map(p => (
        <path
          key={p.id}
          d={p.d}
          fill={p.color}
          opacity={markedForDeletion?.has(p.id) ? 0.3 : 1}
        />
      ))}
    </svg>
  )
})
