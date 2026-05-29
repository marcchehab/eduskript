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

import { memo, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getStroke } from 'perfect-freehand'
import { getSvgPathFromStroke, getStrokeOptions, hasUniformPressure, smoothPoints } from '@/lib/annotations/svg-path'
import type { AnimatedStroke } from '@/hooks/use-stroke-animation'
import { useZoom } from '@/contexts/zoom-context'

type BadgeColor = 'purple' | 'blue' | 'orange' | 'green'

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
  /** Reference-layer styling. Applied to each per-section SVG so the whole
   *  layer dims uniformly (e.g. 0.5 for class-broadcast-as-reference). */
  opacity?: number
  /** Stacking order across overlapping reference layers in the same section. */
  zIndex?: number
  /** When set, one badge per section that has strokes — anchored top-right of
   *  the section element. Use for public/class/individual-feedback layers. */
  badge?: {
    layerId: string
    layerName: string
    layerColor: BadgeColor
    icon: ReactNode
  }
  showBadge?: boolean
}

interface PathDatum {
  id: string
  d: string
  color: string
  sectionOffsetY: number
}

interface SectionBounds {
  /** Paper-y of the topmost stroke point across all strokes in this section. */
  minY: number
  /** Paper-x of the rightmost stroke point across all strokes in this section. */
  maxX: number
  /** sectionOffsetY taken from the first stroke seen for the section (paper-y
   *  of the section's top). All strokes in a section share the same value. */
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
  opacity,
  zIndex,
  badge,
  showBadge = true,
}: SectionAnchoredStrokesProps) {
  // Group renderable strokes by sectionId; build path data once per stroke.
  // Legacy 'unknown' strokes (drawn before paper-top existed, when the
  // capture fallback was the literal string 'unknown') are remapped to
  // 'paper-top' — same effect as if they'd been captured today. Cheaper
  // than a DB migration and the only call site for this component.
  const grouped = useMemo(() => {
    const map = new Map<string, { paths: PathDatum[]; bounds: SectionBounds }>()
    for (const s of strokes) {
      if (!isRenderable(s)) continue
      if (!s.sectionId) continue
      const sid = s.sectionId === 'unknown' ? 'paper-top' : s.sectionId
      const datum = buildPath(s)
      let minY = Infinity
      let maxX = -Infinity
      for (const p of s.points) {
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
      }
      const entry = map.get(sid)
      if (entry) {
        entry.paths.push(datum)
        if (minY < entry.bounds.minY) entry.bounds.minY = minY
        if (maxX > entry.bounds.maxX) entry.bounds.maxX = maxX
      } else {
        map.set(sid, {
          paths: [datum],
          bounds: { minY, maxX, sectionOffsetY: s.sectionOffsetY },
        })
      }
    }
    return map
  }, [strokes])

  // Resolve section IDs to live DOM elements. Re-runs whenever the set of section
  // IDs we care about changes; the effect also catches mount/unmount of section
  // elements due to markdown re-render.
  const [targets, setTargets] = useState<Map<string, HTMLElement>>(() => new Map())
  // Per-section geometry (paper-local CSS px):
  //  - borderTop / borderLeft: section's own border widths. Used to offset the
  //    SVG by the section's border so that SVG.top:0 / left:0 lines up with the
  //    section's border-edge instead of its padding-edge. Without this, sections
  //    like callouts (which have a 6 px left border) shift every stroke drawn
  //    inside them 6 px to the right.
  //  - leftFromPaper: horizontal distance from the paper element's border-left
  //    to the section's border-left. Most sections sit at paperPaddingLeft (the
  //    paper's px-48), but anything inside <fullwidth> is pulled out by -192px
  //    so its sections start at 0 from the paper's border. Without measuring
  //    this per-section, the SVG would be shifted by paperPaddingLeft for any
  //    section that doesn't honour the assumption — strokes drawn over a
  //    fullwidth row would appear ~192 px to the left of where they were drawn.
  const [sectionGeom, setSectionGeom] = useState<
    Map<string, { borderTop: number; borderLeft: number; leftFromPaper: number; topFromPaper: number }>
  >(() => new Map())
  const getZoom = useZoom()

  // Bump on viewport resize so the layout effect re-measures geometry against
  // the current --paper-scale. The scale is set imperatively on
  // document.documentElement by public/layout.tsx (no React state, no
  // re-render), so without this trigger the cached leftFromPaper stays at the
  // old paper-scale and every stroke drifts horizontally as the user resizes
  // the window.
  const [resizeTick, setResizeTick] = useState(0)
  const [liveScale, setLiveScale] = useState(1)
  useLayoutEffect(() => {
    const handle = () => setResizeTick(t => t + 1)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  // useLayoutEffect (not useEffect) so the resolve+setTargets+re-render cycle
  // completes synchronously before the browser paints. Otherwise, when a new
  // section gains its first stroke, there's one paint where the portal target
  // is still missing → committed stroke flashes invisibly until the next frame.
  useLayoutEffect(() => {
    const next = new Map<string, HTMLElement>()
    const nextGeom = new Map<string, { borderTop: number; borderLeft: number; leftFromPaper: number; topFromPaper: number }>()
    // Resolve the paper element once. Sections live inside #paper. The
    // canvas's coord origin (where stored stroke x=0 lives) is the paper's
    // PADDING-edge — that's what the old `-paperPaddingLeft` math implicitly
    // targeted. getBoundingClientRect().left returns the BORDER-edge, so we
    // subtract paper's own border-left-width to land on the padding-edge.
    // Without this, every section is shifted by paper.borderLeft (a few px
    // on bordered themes — visible as a small leftward drift on every stroke).
    //
    // Both rects come from getBoundingClientRect, which is post-transform —
    // i.e. in viewport pixels with every ancestor scale applied. Strokes are
    // stored in paper-local (unscaled) pixels, and the SVG itself is sized in
    // paper-local pixels (width=paperWidth, viewBox=0 0 paperWidth paperHeight).
    //
    // Two distinct scales sit between paper-local and viewport pixels:
    //  - annotation-layer page zoom on <main> (`transform: scale(Z)`, exposed
    //    via ZoomContext)
    //  - paper-responsive shrink on .paper-responsive at narrow viewports
    //    (`transform: scale(var(--paper-scale))`, set imperatively by the
    //    public layout's resize observer — see public/layout.tsx)
    //
    // The annotation hook only knows about the page zoom; combining both is
    // critical, because the section sits INSIDE the paper-responsive scale
    // and getBoundingClientRect picks up both factors. Without the paper
    // scale the delta is undermeasured by `paperScale`, the SVG's `left`
    // (a CSS pixel value inside the paper's transform space) lands too far
    // right, and every stroke drifts horizontally as the viewport narrows.
    const paperEl = document.getElementById('paper')
    const paperRect = paperEl?.getBoundingClientRect()
    const paperCs = paperEl ? window.getComputedStyle(paperEl) : null
    const paperBorderLeft = paperCs ? parseFloat(paperCs.borderLeftWidth) || 0 : 0
    const paperBorderTop = paperCs ? parseFloat(paperCs.borderTopWidth) || 0 : 0
    const zoom = getZoom() || 1
    const paperScale = parseFloat(
      window.getComputedStyle(document.documentElement).getPropertyValue('--paper-scale'),
    ) || 1
    const combinedScale = zoom * paperScale
    // Expose paperScale to the render path so the badge counter-scale can
    // factor it in too. setLiveScale is a no-op if value is unchanged so the
    // common case (no resize) doesn't re-render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the same DOM-measurement → state pattern used for targets/sectionGeom below.
    setLiveScale(prev => (prev === paperScale ? prev : paperScale))
    for (const sid of grouped.keys()) {
      const el = document.querySelector(`[data-section-id="${CSS.escape(sid)}"]`)
      if (el instanceof HTMLElement) {
        next.set(sid, el)
        const cs = window.getComputedStyle(el)
        const elRect = el.getBoundingClientRect()
        nextGeom.set(sid, {
          borderTop: parseFloat(cs.borderTopWidth) || 0,
          borderLeft: parseFloat(cs.borderLeftWidth) || 0,
          leftFromPaper: paperRect
            ? (elRect.left - paperRect.left) / combinedScale - paperBorderLeft
            : paperPaddingLeft,
          // Section's top relative to the paper's padding-edge top (same
          // scale-aware math as leftFromPaper). Used to clip the SVG height so
          // it reaches the paper bottom but never spills below — an absolutely
          // positioned full-paperHeight SVG anchored at a mid-page section
          // would otherwise extend a whole page past the paper bottom and
          // inflate #scroll-container.scrollHeight (phantom scroll + broken
          // reading-progress total).
          topFromPaper: paperRect
            ? (elRect.top - paperRect.top) / combinedScale - paperBorderTop
            : 0,
        })
      }
    }

     
    setTargets((prev) => {
      if (prev.size !== next.size) return next
      for (const [k, v] of next) {
        if (prev.get(k) !== v) return next
      }
      return prev
    })
     
    setSectionGeom((prev) => {
      if (prev.size !== nextGeom.size) return nextGeom
      for (const [k, v] of nextGeom) {
        const old = prev.get(k)
        if (!old || old.borderTop !== v.borderTop || old.borderLeft !== v.borderLeft || old.leftFromPaper !== v.leftFromPaper || old.topFromPaper !== v.topFromPaper) {
          return nextGeom
        }
      }
      return prev
    })

    if (onOrphansChange) {
      // Hide orphans whose lost section was a markdown-dynamic-height element
      // (callout, code-editor, plugin). The user's mental model: each variable-
      // height element is its own section, and "the element disappears" should
      // imply "its annotations disappear too". When the markdown is edited to
      // remove a callout, its section element unmounts; surfacing those strokes
      // in the orphan-fallback layer would render them at their absolute paper-y
      // — but the layout shifted when the element was removed, so the position
      // is meaningless. Drop them silently. Heading-/spacer- orphans still
      // surface (transient unmount during Fast Refresh, or genuinely lost
      // references the user can clean up via the orphans banner).
      const orphans = strokes.filter(s => {
        if (!isRenderable(s)) return false
        // Mirror the 'unknown' → 'paper-top' remap in `grouped` so legacy
        // strokes anchored to 'unknown' aren't surfaced as orphans when the
        // paper-top sentinel exists.
        const sid = s.sectionId === 'unknown' ? 'paper-top' : s.sectionId
        if (sid && next.has(sid)) return false
        if (sid && /^(callout|editor|plugin)-/.test(sid)) return false
        return true
      })
      onOrphansChange(orphans)
    }
    // headingPositions is in deps purely as a re-run trigger; we don't read its
    // values here. Including it ensures we re-query DOM targets on every layout
    // recomputation, which is the moment when section elements may have been
    // recreated by the spacer-injection effect. resizeTick has the same role
    // for viewport-width changes that update --paper-scale.
  }, [grouped, strokes, onOrphansChange, headingPositions, resizeTick, getZoom, paperPaddingLeft])

  const zoom = getZoom() || 1
  // Counter-scale the badge against BOTH transforms in its ancestor chain
  // (page zoom × paper-responsive scale) so it stays readable at any combo.
  const badgeScaleSource = zoom * liveScale

  return (
    <>
      {Array.from(grouped.entries()).map(([sid, { paths, bounds }]) => {
        const target = targets.get(sid)
        if (!target) return null
        const geom = sectionGeom.get(sid) ?? { borderTop: 0, borderLeft: 0, leftFromPaper: paperPaddingLeft, topFromPaper: 0 }
        return createPortal(
          <>
            <SectionStrokeSvg
              paths={paths}
              paperWidth={paperWidth}
              paperHeight={paperHeight}
              sectionLeftFromPaper={geom.leftFromPaper}
              sectionTopFromPaper={geom.topFromPaper}
              sectionBorderTop={geom.borderTop}
              sectionBorderLeft={geom.borderLeft}
              markedForDeletion={markedForDeletion}
              opacity={opacity}
              zIndex={zIndex}
            />
            {badge && showBadge && (
              <SectionLayerBadge
                layerId={badge.layerId}
                layerName={badge.layerName}
                layerColor={badge.layerColor}
                icon={badge.icon}
                zoom={badgeScaleSource}
                bounds={bounds}
                leftFromPaper={geom.leftFromPaper}
              />
            )}
          </>,
          target,
          // Stable React reconciliation key per section
          `stroke-portal:${sid}`,
        )
      })}
    </>
  )
})

const BADGE_COLOR_CLASSES: Record<BadgeColor, string> = {
  purple: 'layer-badge-purple',
  blue: 'layer-badge-blue',
  orange: 'layer-badge-orange',
  green: 'layer-badge-green',
}

/**
 * One badge per section that owns reference-layer strokes. Lives inside the
 * same portal as the section's SVG, so it follows the section through reflow
 * — no JS reposition. Badge scales inversely with zoom so it stays readable.
 *
 * Positioned next to the stroke cluster (not at the section's top-right
 * corner) so it sits visually adjacent to the strokes it labels — same UX as
 * the active-layer `LayerBadges`. For a tall section whose strokes live at
 * the bottom, this keeps the badge near the strokes instead of floating
 * above the section heading.
 */
function SectionLayerBadge({
  layerId,
  layerName,
  layerColor,
  icon,
  zoom,
  bounds,
  leftFromPaper,
}: {
  layerId: string
  layerName: string
  layerColor: BadgeColor
  icon: ReactNode
  zoom: number
  bounds: SectionBounds
  /** Section's left edge in paper coords. Used to convert paper-x to
   *  section-local x for `left` positioning. */
  leftFromPaper: number
}) {
  const badgeScale = 1 / zoom
  // Convert paper coords to section-local. SVG inside the portal uses
  // <g transform="translate(0, -sectionOffsetY)"> to shift paper-y back to
  // section-local-y; we mirror that here. Section-local x = paper-x minus
  // section's leftFromPaper.
  const sectionLocalTop = bounds.minY - bounds.sectionOffsetY
  const sectionLocalRight = bounds.maxX - leftFromPaper
  return (
    <div
      key={layerId}
      className={`layer-badge ${BADGE_COLOR_CLASSES[layerColor]}`}
      style={{
        position: 'absolute',
        top: sectionLocalTop - 24 * badgeScale,
        left: sectionLocalRight + 8 * badgeScale,
        transform: `scale(${badgeScale})`,
        transformOrigin: 'top left',
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      {icon}
      <span className="layer-badge-text">{layerName}</span>
    </div>
  )
}

function SectionStrokeSvg({
  paths,
  paperWidth,
  paperHeight,
  sectionLeftFromPaper,
  sectionTopFromPaper,
  sectionBorderTop,
  sectionBorderLeft,
  markedForDeletion,
  opacity,
  zIndex,
}: {
  paths: PathDatum[]
  paperWidth: number
  paperHeight: number
  sectionLeftFromPaper: number
  /** Section's top in paper coords. The SVG box+viewBox are clipped to
   *  `paperHeight - sectionTopFromPaper` so the box reaches the paper bottom
   *  without spilling below it (which inflated scroll height). */
  sectionTopFromPaper: number
  sectionBorderTop: number
  sectionBorderLeft: number
  markedForDeletion?: Set<string>
  opacity?: number
  zIndex?: number
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

  // Clip the box (and viewBox, to keep the 1:1 identity scale under
  // preserveAspectRatio="none") so the SVG bottom lands at the paper bottom
  // instead of a full paperHeight below this section's top. overflow:visible
  // still paints any stroke beyond the box, so rendering is unchanged — but the
  // box no longer spills past the paper to inflate scroll height. Floored well
  // above zero: a zero-area SVG isn't painted at all (Chrome), and the box must
  // stay tall enough to cover a foldable callout it may be portaled into.
  const clippedHeight = Math.max(200, paperHeight - sectionTopFromPaper)

  return (
    <svg
      className="annotation-section-svg"
      viewBox={`0 0 ${paperWidth} ${clippedHeight}`}
      preserveAspectRatio="none"
      style={{
        // Place SVG-x=0 at the paper's border-left (canvas's coord origin),
        // not at this section's border-left, so paths drawn in paper-absolute
        // coords land at the right viewport-x. The shift is the section's
        // measured offset from the paper plus the section's own border-left
        // (CSS `left:0` on an abs child is the padding-edge, not the border-
        // edge, so we back out the border too).
        // Without per-section measurement, sections inside <fullwidth>
        // (which pulls children -192px out of paper's px-48 padding) would
        // be shifted by paperPaddingLeft and strokes would jump left by 192px.
        // Top is just the section's own border-top — section vertical offset
        // is handled by the per-offsetY <g translate> below.
        position: 'absolute',
        top: -sectionBorderTop,
        left: -sectionLeftFromPaper - sectionBorderLeft,
        width: paperWidth,
        height: clippedHeight,
        pointerEvents: 'none',
        overflow: 'visible',
        opacity,
        zIndex,
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
