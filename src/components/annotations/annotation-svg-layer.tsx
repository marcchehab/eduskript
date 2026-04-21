/**
 * SVG Annotation Layer - Resolution-Independent Stroke Rendering
 *
 * Renders committed annotation strokes as SVG <path> elements instead of
 * canvas pixels. SVG paths scale with CSS transform natively, staying crisp
 * at any zoom level without hitting canvas pixel area limits (16M on iOS).
 *
 * Repositioning modes (mutually exclusive):
 *
 * 1. `sectionTransforms` — for reference layers (other users' annotations).
 *    Pre-computed per-section deltas from old heading offsets → current positions.
 *    Groups strokes by sectionId, one <g transform> per section.
 *
 * 2. `headingPositions` — for the active layer (user's own annotations).
 *    Computes per-stroke deltas from stroke.sectionOffsetY → current heading Y.
 *    Groups by (sectionId, sectionOffsetY) since strokes drawn at different
 *    layout states may have different baselines within the same section.
 *
 * @see svg-path.ts - SVG path conversion and section transform computation
 * @see annotation-layer.tsx - Parent component managing layers
 * @see simple-canvas.tsx - Viewport canvas for active drawing
 */

'use client'

import { memo, useMemo } from 'react'
import { getStroke } from 'perfect-freehand'
import { getSvgPathFromStroke, getStrokeOptions, hasUniformPressure, smoothPoints, type SectionTransform } from '@/lib/annotations/svg-path'
import type { AnimatedStroke } from '@/hooks/use-stroke-animation'

interface AnnotationSvgLayerProps {
  strokes: AnimatedStroke[]
  width: number            // paper width (viewBox)
  height: number           // paper height (viewBox)
  markedForDeletion?: Set<string>  // stroke IDs at 0.3 opacity (eraser preview)
  /** Reference layers: pre-computed per-section transforms from old → current offsets */
  sectionTransforms?: Map<string, SectionTransform>
  /** Active layer: current heading positions for per-stroke sectionOffsetY transforms */
  headingPositions?: Array<{ sectionId: string; offsetY: number }>
  className?: string
}

interface PathDatum {
  id: string
  d: string
  color: string
  sectionId: string
  sectionOffsetY: number
}

/**
 * Render strokes as SVG paths with optional per-section or per-stroke repositioning.
 */
export const AnnotationSvgLayer = memo(function AnnotationSvgLayer({
  strokes,
  width,
  height,
  markedForDeletion,
  sectionTransforms,
  headingPositions,
  className = '',
}: AnnotationSvgLayerProps) {
  // Pre-compute SVG path data for each stroke
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
          sectionId: stroke.sectionId,
          sectionOffsetY: stroke.sectionOffsetY,
        }
      })
  }, [strokes])

  // Build current heading lookup for per-stroke transforms
  const currentHeadingMap = useMemo(() => {
    if (!headingPositions || headingPositions.length === 0) return null
    return new Map(headingPositions.map(h => [h.sectionId, h.offsetY]))
  }, [headingPositions])

  // Group paths by transform key and compute transforms.
  // - sectionTransforms mode: group by sectionId
  // - headingPositions mode: group by (sectionId, sectionOffsetY)
  // - neither: no grouping (flat render)
  const groups = useMemo(() => {
    if (!sectionTransforms && !currentHeadingMap) return null

    const result = new Map<string, { dx: number; dy: number; paths: PathDatum[] }>()

    for (const p of pathData) {
      let groupKey: string
      let dx = 0
      let dy = 0

      if (sectionTransforms) {
        // Reference layer mode: per-section transforms
        groupKey = p.sectionId || '__no_section__'
        const t = sectionTransforms.get(p.sectionId)
        if (t) { dx = t.dx; dy = t.dy }
      } else {
        // Active layer mode: per-stroke transforms from sectionOffsetY
        const currentY = currentHeadingMap!.get(p.sectionId)
        if (currentY !== undefined && p.sectionOffsetY !== undefined) {
          dy = currentY - p.sectionOffsetY
        }
        // Group by (sectionId, sectionOffsetY) — strokes drawn at different
        // layout states get different transforms even within the same section
        groupKey = `${p.sectionId}:${p.sectionOffsetY}`
      }

      let group = result.get(groupKey)
      if (!group) {
        group = { dx, dy, paths: [] }
        result.set(groupKey, group)
      }
      group.paths.push(p)
    }

    return result
  }, [pathData, sectionTransforms, currentHeadingMap])

  if (pathData.length === 0) return null

  const renderPath = (p: PathDatum) => (
    <path
      key={p.id}
      d={p.d}
      fill={p.color}
      opacity={markedForDeletion?.has(p.id) ? 0.3 : 1}
    />
  )

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
      {groups ? (
        Array.from(groups.entries()).map(([key, { dx, dy, paths }]) => {
          if (dx !== 0 || dy !== 0) {
            return (
              <g key={key} transform={`translate(${dx},${dy})`}>
                {paths.map(renderPath)}
              </g>
            )
          }
          return <g key={key}>{paths.map(renderPath)}</g>
        })
      ) : (
        pathData.map(renderPath)
      )}
    </svg>
  )
})
