'use client'

/**
 * Section-anchored stroke renderer.
 *
 * Renders committed strokes as a small SVG portaled into each
 * `[data-section-id]` element on the page. The browser's layout engine
 * carries the SVG with its host section: when the section moves
 * (spacer added, callout opened, code editor resized, image loaded),
 * the SVG moves with it. No JS recomputation, no debounce, no per-render
 * `getBoundingClientRect` sweep.
 *
 * Coordinate system inside each section's SVG:
 * - x is paper-absolute (matches the stroke's stored `points[i].x`).
 * - y is paper-absolute too; we shift back to section-local via
 *   `<g transform="translate(0, -sectionOffsetY)">` per (offsetY) group.
 *   The SVG itself sits at the section element's top in paper coords,
 *   so the visual y of any stroke point ends up at
 *   `currentSectionTop + (point.y - sectionOffsetY)` — exactly the legacy
 *   transform pipeline produced, without any JS state.
 *
 * X is shifted by `paperPaddingLeft` because section elements (children of
 * `.markdown-content`) start at the paper's content padding, not its
 * outer edge. We render strokes at `point.x - paperPaddingLeft` so a
 * stored paper-X of 200 lines up with the visual paper-X of 200.
 *
 * Strokes whose `sectionId` does not resolve to any live DOM element are
 * surfaced via `onOrphansChange` so the caller can render them in a
 * paper-anchored fallback (with no JS reposition) — same orphan UX as
 * before this refactor.
 */

import { memo, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getStroke } from 'perfect-freehand'
import { getSvgPathFromStroke, getStrokeOptions, hasUniformPressure, smoothPoints } from '@/lib/annotations/svg-path'
import type { AnimatedStroke } from '@/hooks/use-stroke-animation'

interface SectionAnchoredStrokesProps {
  strokes: AnimatedStroke[]
  paperWidth: number
  paperHeight: number
  paperPaddingLeft: number
  markedForDeletion?: Set<string>
  /** Fired with strokes whose sectionId is not currently in the DOM (deleted section,
   *  pre-load, etc.). Caller renders these in a fallback paper-anchored overlay. */
  onOrphansChange?: (orphans: AnimatedStroke[]) => void
  /** Used purely as a re-resolution trigger: whenever the section DOM layout
   *  changes (markdown re-render, spacer add/resize/remove, callout open),
   *  parent's headingPositions ref changes. We listen to that to re-query
   *  cached HTMLElement targets — without it, a teardown+recreate of a
   *  section element would leave us pointing at a detached node and the
   *  portaled strokes would silently disappear until the next data change. */
  headingPositions?: Array<{ sectionId: string; offsetY: number }>
}

interface PathDatum {
  id: string
  d: string
  color: string
  sectionOffsetY: number
}

const isRenderable = (s: AnimatedStroke) => s.mode !== 'erase' && s.points.length >= 2

function buildPath(stroke: AnimatedStroke): PathDatum {
  const isUniform = hasUniformPressure(stroke.points)
  const sourcePoints = isUniform ? smoothPoints(stroke.points) : stroke.points
  const inputPoints = sourcePoints.map(p => [p.x, p.y, p.pressure])
  const outline = getStroke(inputPoints, getStrokeOptions(stroke.width, true, isUniform))
  return {
    id: stroke.id,
    d: getSvgPathFromStroke(outline),
    color: stroke.color,
    sectionOffsetY: stroke.sectionOffsetY,
  }
}

export const SectionAnchoredStrokes = memo(function SectionAnchoredStrokes({
  strokes,
  paperWidth,
  paperHeight,
  paperPaddingLeft,
  markedForDeletion,
  onOrphansChange,
  headingPositions,
}: SectionAnchoredStrokesProps) {
  // Group renderable strokes by sectionId; build path data once per stroke.
  const grouped = useMemo(() => {
    const map = new Map<string, PathDatum[]>()
    for (const s of strokes) {
      if (!isRenderable(s)) continue
      if (!s.sectionId) continue
      const arr = map.get(s.sectionId)
      const datum = buildPath(s)
      if (arr) arr.push(datum)
      else map.set(s.sectionId, [datum])
    }
    return map
  }, [strokes])

  // Resolve section IDs to live DOM elements. Re-runs whenever the set of section
  // IDs we care about changes; the effect also catches mount/unmount of section
  // elements due to markdown re-render.
  const [targets, setTargets] = useState<Map<string, HTMLElement>>(() => new Map())

  // useLayoutEffect (not useEffect) so the resolve+setTargets+re-render cycle
  // completes synchronously before the browser paints. Otherwise, when a new
  // section gains its first stroke, there's one paint where the portal target
  // is still missing → committed stroke flashes invisibly until the next frame.
  useLayoutEffect(() => {
    const next = new Map<string, HTMLElement>()
    for (const sid of grouped.keys()) {
      const el = document.querySelector(`[data-section-id="${CSS.escape(sid)}"]`)
      if (el instanceof HTMLElement) next.set(sid, el)
    }



    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: querying live DOM for portal targets after render. Same-value short-circuit prevents cascade.
    setTargets((prev) => {
      if (prev.size !== next.size) return next
      for (const [k, v] of next) {
        if (prev.get(k) !== v) return next
      }
      return prev
    })

    if (onOrphansChange) {
      const orphans = strokes.filter(s => isRenderable(s) && (!s.sectionId || !next.has(s.sectionId)))
      onOrphansChange(orphans)
    }
    // headingPositions is in deps purely as a re-run trigger; we don't read its
    // values here. Including it ensures we re-query DOM targets on every layout
    // recomputation, which is the moment when section elements may have been
    // recreated by the spacer-injection effect.
  }, [grouped, strokes, onOrphansChange, headingPositions])

  return (
    <>
      {Array.from(grouped.entries()).map(([sid, paths]) => {
        const target = targets.get(sid)
        if (!target) return null
        return createPortal(
          <SectionStrokeSvg
            paths={paths}
            paperWidth={paperWidth}
            paperHeight={paperHeight}
            paperPaddingLeft={paperPaddingLeft}
            markedForDeletion={markedForDeletion}
          />,
          target,
          // Stable React reconciliation key per section
          `stroke-portal:${sid}`,
        )
      })}
    </>
  )
})

function SectionStrokeSvg({
  paths,
  paperWidth,
  paperHeight,
  paperPaddingLeft,
  markedForDeletion,
}: {
  paths: PathDatum[]
  paperWidth: number
  paperHeight: number
  paperPaddingLeft: number
  markedForDeletion?: Set<string>
}) {
  // Strokes drawn at different sectionOffsetY values (e.g. user drew, then layout
  // shifted, then drew again before saving) need their own translate so each lands
  // in section-local space.
  const offsetGroups = useMemo(() => {
    const map = new Map<number, PathDatum[]>()
    for (const p of paths) {
      const arr = map.get(p.sectionOffsetY)
      if (arr) arr.push(p)
      else map.set(p.sectionOffsetY, [p])
    }
    return map
  }, [paths])

  return (
    <svg
      className="annotation-section-svg"
      viewBox={`0 0 ${paperWidth} ${paperHeight}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        top: 0,
        left: -paperPaddingLeft,
        width: paperWidth,
        height: paperHeight,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {Array.from(offsetGroups.entries()).map(([offsetY, ps]) => (
        <g key={offsetY} transform={`translate(0, ${-offsetY})`}>
          {ps.map(p => (
            <path
              key={p.id}
              d={p.d}
              fill={p.color}
              opacity={markedForDeletion?.has(p.id) ? 0.3 : 1}
            />
          ))}
        </g>
      ))}
    </svg>
  )
}
