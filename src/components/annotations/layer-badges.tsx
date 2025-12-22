'use client'

/**
 * Layer Badges - Visual indicators for annotation layer ownership
 *
 * Displays floating badges near groups of strokes to indicate which layer
 * (student work, class broadcast, individual feedback) they belong to.
 * This replaces the purple hue-rotate filter approach which looked "sickly".
 *
 * ## How It Works
 *
 * 1. Parses canvas data and groups strokes by proximity
 * 2. Renders one badge per stroke group
 * 3. Badge positioned at top-right of group bounds
 * 4. Scales inversely with zoom to maintain readable size
 *
 * ## Badge Colors
 *
 * - purple: Student work (teacher viewing student's annotations)
 * - blue: Class broadcast (student viewing teacher's class-wide annotations)
 * - orange: Individual feedback (student viewing teacher's personal feedback)
 * - green: Page broadcast (everyone viewing public annotations)
 *
 * @see stroke-grouping.ts - Grouping algorithm
 * @see annotation-layer.tsx - Where badges are rendered
 */

import { useMemo, type ReactNode } from 'react'
import { groupStrokes } from '@/lib/annotations/stroke-grouping'

type BadgeColor = 'purple' | 'blue' | 'orange' | 'green'

interface LayerBadgesProps {
  canvasData: string
  layerId: string
  layerName: string
  layerColor: BadgeColor
  icon: ReactNode
  zoom: number
}

// Badge color classes
const colorClasses: Record<BadgeColor, string> = {
  purple: 'layer-badge-purple',
  blue: 'layer-badge-blue',
  orange: 'layer-badge-orange',
  green: 'layer-badge-green'
}

export function LayerBadges({
  canvasData,
  layerId,
  layerName,
  layerColor,
  icon,
  zoom
}: LayerBadgesProps) {
  const groups = useMemo(() => groupStrokes(canvasData), [canvasData])

  if (groups.length === 0) {
    return null
  }

  // Scale factor to keep badges readable at any zoom level
  // At zoom=1, badge is normal size. At zoom=2, badge renders at 50% to appear same size
  const badgeScale = 1 / zoom

  return (
    <>
      {groups.map(group => {
        // Position badge at top-right of group bounds
        // Offset by 8px from the content
        const top = group.bounds.minY - 24 * badgeScale
        const left = group.bounds.maxX + 8 * badgeScale

        return (
          <div
            key={`${layerId}-${group.id}`}
            className={`layer-badge ${colorClasses[layerColor]}`}
            style={{
              position: 'absolute',
              top,
              left,
              transform: `scale(${badgeScale})`,
              transformOrigin: 'top left',
              zIndex: 50,
            }}
          >
            {icon}
            <span className="layer-badge-text">{layerName}</span>
          </div>
        )
      })}
    </>
  )
}
