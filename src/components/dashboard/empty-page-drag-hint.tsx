'use client'

import { useEffect, useState } from 'react'
import { Hand } from 'lucide-react'

interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
}

// Shown only while the page builder is empty. Points from the drag handle of
// the first skript in the Content Library to the empty drop zone, hinting at
// drag-and-drop as an alternative to "Start from scratch" / "Examples".
// Anchors are looked up by id (rather than refs) since the two elements live
// in sibling component trees (ContentLibrary vs PageBuilder) with no shared
// parent that owns both.
export function EmptyPageDragHint({ watch }: { watch?: number | string }) {
  const [line, setLine] = useState<Line | null>(null)

  useEffect(() => {
    const measure = () => {
      const from = document.getElementById('content-library-first-skript-hint')
      const to = document.getElementById('page-builder-empty-drop-zone')
      if (!from || !to) {
        setLine(null)
        return
      }
      const fromRect = from.getBoundingClientRect()
      const toRect = to.getBoundingClientRect()
      const x1 = fromRect.left + fromRect.width / 2
      const y1 = fromRect.top + fromRect.height / 2
      const targetX = toRect.right - 16
      const targetY = toRect.top + 24
      // Only draw a third of the way to the drop zone — a short nudge
      // toward the page builder reads better than a line spanning the gap.
      setLine({
        x1,
        y1,
        x2: x1 + (targetX - x1) / 3,
        y2: y1 + (targetY - y1) / 3,
      })
    }
    // The library's skript list loads asynchronously after mount, so the
    // first measurement can miss it — retry a couple of times.
    measure()
    const t1 = setTimeout(measure, 200)
    const t2 = setTimeout(measure, 800)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('resize', measure)
    }
  }, [watch])

  if (!line) return null

  const midX = (line.x1 + line.x2) / 2

  return (
    <div className="pointer-events-none fixed inset-0 z-30 hidden lg:block" aria-hidden="true">
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        <defs>
          <marker id="drag-hint-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" className="fill-primary" />
          </marker>
        </defs>
        <path
          d={`M${line.x1},${line.y1} C${midX},${line.y1} ${midX},${line.y2} ${line.x2},${line.y2}`}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeDasharray="5 5"
          markerEnd="url(#drag-hint-arrowhead)"
        />
      </svg>
      <Hand
        className="absolute w-5 h-5 text-primary -translate-x-1/2 -translate-y-1/2 -rotate-45 drop-shadow"
        style={{ left: line.x1, top: line.y1 }}
      />
    </div>
  )
}
