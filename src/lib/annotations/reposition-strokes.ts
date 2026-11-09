/**
 * Section detection utility.
 *
 * Strokes, snaps, and sticky-notes are now portaled into their anchor section
 * via `[data-section-id]` and follow the section through the browser's own
 * layout engine — no JS reposition pass, no persisted-delta updates. The old
 * `repositionStrokes` / `repositionSnaps` / `repositionStickyNote` helpers and
 * the per-record `headingOffsets` / `sectionOffsetY` math they consumed are
 * gone (commit history if anyone needs to dig them up). What remains is the
 * section-detection helper that the draw / drag handlers use to stamp a
 * `sectionId` onto newly placed content, plus the `HeadingPosition` shape they
 * pass around.
 *
 * Filename is left as `reposition-strokes.ts` because every importer still
 * deep-links to that path; rename in a follow-up if you want.
 *
 * @see section-anchored-strokes.tsx - The per-section portal renderer that
 *      replaced the legacy reposition logic.
 */

export interface HeadingPosition {
  sectionId: string
  offsetY: number
  headingText: string
}

/**
 * Returns the sectionId of the last heading whose offsetY is <= y, or null
 * when y falls above the first heading.
 */
export function determineSectionFromY(
  y: number,
  headingPositions: HeadingPosition[],
): string | null {
  if (headingPositions.length === 0) return null

  const sorted = [...headingPositions].sort((a, b) => a.offsetY - b.offsetY)

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (y >= sorted[i].offsetY) {
      return sorted[i].sectionId
    }
  }

  return null
}

/**
 * Visual y-shift that maps a stored stroke onto where the section-anchored SVG
 * renders it *right now*. The SVG renderer carries each stroke with its
 * `[data-section-id]` host through reflow (added content, opened callout, …).
 * Consumers that work off the stored paper coordinates instead — the eraser
 * hit-test and the active-layer badge — keep pointing at the pre-reflow spot
 * unless they add this shift.
 *
 * shift = liveSectionTop − storedSectionOffsetY, where liveSectionTop is the
 * section's current offset from `headingPositions`. Returns 0 when the section
 * isn't in `headingPositions` (orphan, or not measured yet) — i.e. leave it at
 * the stored coords, matching the orphan-fallback layer. The `unknown` →
 * `paper-top` remap mirrors section-anchored-strokes.tsx so legacy strokes
 * resolve to the same live anchor the SVG uses.
 */
export function liveSectionYShift(
  sectionId: string | undefined,
  storedSectionOffsetY: number | undefined,
  headingPositions: HeadingPosition[],
): number {
  if (!sectionId || storedSectionOffsetY === undefined) return 0
  const sid = sectionId === 'unknown' ? 'paper-top' : sectionId
  const live = headingPositions.find(h => h.sectionId === sid)
  if (!live) return 0
  return live.offsetY - storedSectionOffsetY
}

interface RepositionableStroke {
  points: Array<{ x: number; y: number; pressure?: number }>
  sectionId?: string
  sectionOffsetY?: number
  avgY?: number
  [key: string]: unknown
}

/**
 * Returns `canvasData` with every stroke's points (and `avgY`) shifted to its
 * live visual paper-y via {@link liveSectionYShift}. Used to feed paper-coord
 * consumers (the active-layer badge grouping) the same positions the SVG layer
 * paints, so labels track content reflow instead of sticking to the draw-time
 * position. Stored data is never mutated — this produces a throwaway string for
 * display/measurement only. Returns the input unchanged when nothing shifts.
 */
export function repositionCanvasDataToLive(
  canvasData: string,
  headingPositions: HeadingPosition[],
): string {
  if (!canvasData || headingPositions.length === 0) return canvasData
  let strokes: RepositionableStroke[]
  try {
    strokes = JSON.parse(canvasData)
  } catch {
    return canvasData
  }
  if (!Array.isArray(strokes)) return canvasData

  let changed = false
  const next = strokes.map((s) => {
    const shift = liveSectionYShift(s.sectionId, s.sectionOffsetY, headingPositions)
    if (shift === 0) return s
    changed = true
    return {
      ...s,
      points: s.points.map((p) => ({ ...p, y: p.y + shift })),
      avgY: s.avgY !== undefined ? s.avgY + shift : s.avgY,
    }
  })

  return changed ? JSON.stringify(next) : canvasData
}

/**
 * Measures every `[data-section-id]` element inside `container` as a
 * {@link HeadingPosition} (paper-y relative to `originTop`, unscaled by
 * `scale`).
 *
 * Dynamic-height elements (foldable callouts, code editors, flex rows) also
 * get a `${id}-end` entry for their bottom edge — but ONLY when the DOM has no
 * real `${id}-end` sentinel. The rehype plugin inserts such a 0-height sentinel
 * right after each dynamic-height element, and that sentinel is what the
 * stroke renderer and the draw-commit measurement anchor to. It sits below the
 * element's bottom MARGIN, not its border-box bottom, so a synthetic entry
 * measured from `rect.bottom` sits ~one margin (20 px for a callout) higher.
 * With both in the list, `find()` returned the synthetic one first and every
 * consumer that shifts by `headingPositions` (eraser hit-test, layer badges)
 * was off by that margin for strokes below a foldable callout — the eraser
 * removed strokes ~20 px below its circle.
 */
export function measureHeadingPositions(
  container: ParentNode,
  originTop: number,
  scale: number,
): HeadingPosition[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-section-id]'))
  const present = new Set(elements.map(el => el.getAttribute('data-section-id')))
  const positions: HeadingPosition[] = []
  const s = scale || 1

  for (const element of elements) {
    const sectionId = element.getAttribute('data-section-id')
    if (!sectionId) continue
    const rect = element.getBoundingClientRect()
    positions.push({
      sectionId,
      offsetY: (rect.top - originTop) / s,
      headingText: element.getAttribute('data-heading-text') || '',
    })
    // Track the bottom so annotations BELOW the element follow it when it
    // expands/collapses — unless a real end sentinel already does that.
    if (
      element.getAttribute('data-dynamic-height') === 'true' &&
      !present.has(`${sectionId}-end`)
    ) {
      positions.push({
        sectionId: `${sectionId}-end`,
        offsetY: (rect.bottom - originTop) / s,
        headingText: '',
      })
    }
  }
  return positions
}

/**
 * Live paper-y of a section's top, measured against `originEl` (the element
 * whose top is paper-y 0 for strokes — the canvas wrapper, i.e. the canvas's
 * offsetParent). Returns null when the section or #paper is not in the DOM.
 *
 * Measured, not taken from the debounced headingPositions cache, which can be
 * stale at commit time. Scale = paperRect.width / offsetWidth (width-based:
 * offsetHeight is integer-rounded); origin = the wrapper's own rect, not
 * paper top + border × scale (border rendering is device-pixel rounded).
 * Used by the draw commit (simple-canvas.tsx) and selection moves
 * (annotation-layer.tsx) so both anchor identically.
 */
export function measureSectionOffsetY(sectionId: string, originEl: HTMLElement | null): number | null {
  if (typeof document === 'undefined') return null
  const sectionEl = document.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`)
  const paperEl = document.getElementById('paper')
  if (!(sectionEl instanceof HTMLElement) || !paperEl) return null
  const liveScale = paperEl.getBoundingClientRect().width / paperEl.offsetWidth || 1
  const origin = originEl ?? paperEl
  return (sectionEl.getBoundingClientRect().top - origin.getBoundingClientRect().top) / liveScale
}
