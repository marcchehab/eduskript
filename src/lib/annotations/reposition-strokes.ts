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
  /** Alias entry for a legacy section id (same element, same offsetY as the
   *  entry before it). Lets `.find(sectionId)` lookups resolve strokes stored
   *  with legacy ids; {@link determineSectionFromY} skips these so new
   *  content is always stamped with the current id. */
  legacy?: boolean
}

/**
 * Attribute on the `paper-top` sentinel holding a JSON object
 * `{ legacyId: currentId }` for every section anchor of the document, written
 * by src/lib/rehype-plugins/heading-section-ids.ts (see its ID FORMAT notes).
 * One map on a plain div instead of a second attribute per element because the
 * components rendering callouts, code blocks, plugins, … pass through only
 * `data-section-id`.
 */
export const LEGACY_SECTION_IDS_ATTR = 'data-legacy-section-ids'

/**
 * Legacy → current section id, merged from every
 * {@link LEGACY_SECTION_IDS_ATTR} map under `root` in document order (first
 * wins, matching querySelector's first-match on the old ids). O(anchors).
 */
export function readLegacySectionIds(root: ParentNode = document): Map<string, string> {
  const map = new Map<string, string>()
  for (const el of Array.from(root.querySelectorAll(`[${LEGACY_SECTION_IDS_ATTR}]`))) {
    try {
      const obj = JSON.parse(el.getAttribute(LEGACY_SECTION_IDS_ATTR) || '{}') as Record<string, unknown>
      for (const [legacy, current] of Object.entries(obj)) {
        if (typeof current === 'string' && !map.has(legacy)) map.set(legacy, current)
      }
    } catch {
      // Malformed map: legacy ids under it stay unresolved (orphans).
    }
  }
  return map
}

/**
 * The live `[data-section-id]` element for a stored section id, current or
 * legacy. Current ids are tried first; the two namespaces are disjoint (current
 * block/heading ids contain `@`, legacy ones never do), so the order only
 * matters for ids that are the same in both (`paper-top`, `spacer-…`).
 * Pass `legacy` when resolving many ids to parse the map once.
 */
export function findSectionElement(
  sectionId: string,
  root: ParentNode = document,
  legacy?: Map<string, string>,
): HTMLElement | null {
  const query = (id: string) => root.querySelector(`[data-section-id="${CSS.escape(id)}"]`)
  const direct = query(sectionId)
  if (direct instanceof HTMLElement) return direct
  const current = (legacy ?? readLegacySectionIds(root)).get(sectionId)
  const el = current ? query(current) : null
  return el instanceof HTMLElement ? el : null
}

/**
 * Returns the sectionId of the last heading whose offsetY is <= y, or null
 * when y falls above the first heading. Legacy alias entries are ignored.
 */
export function determineSectionFromY(
  y: number,
  headingPositions: HeadingPosition[],
): string | null {
  const sorted = headingPositions.filter(h => !h.legacy).sort((a, b) => a.offsetY - b.offsetY)
  if (sorted.length === 0) return null

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
 *
 * Each entry whose id has a legacy id in the {@link LEGACY_SECTION_IDS_ATTR}
 * map is followed by an alias entry (`legacy: true`, same offsetY), so lookups
 * of strokes stored with legacy ids find their live section.
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
  const legacyOf = new Map<string, string[]>()
  for (const [legacy, current] of readLegacySectionIds(container)) {
    const list = legacyOf.get(current)
    if (list) list.push(legacy)
    else legacyOf.set(current, [legacy])
  }
  const push = (sectionId: string, offsetY: number, headingText: string) => {
    positions.push({ sectionId, offsetY, headingText })
    for (const legacy of legacyOf.get(sectionId) ?? []) {
      positions.push({ sectionId: legacy, offsetY, headingText, legacy: true })
    }
  }

  for (const element of elements) {
    const sectionId = element.getAttribute('data-section-id')
    if (!sectionId) continue
    const rect = element.getBoundingClientRect()
    push(sectionId, (rect.top - originTop) / s, element.getAttribute('data-heading-text') || '')
    // Track the bottom so annotations BELOW the element follow it when it
    // expands/collapses — unless a real end sentinel already does that.
    if (
      element.getAttribute('data-dynamic-height') === 'true' &&
      !present.has(`${sectionId}-end`)
    ) {
      const bottom = (rect.bottom - originTop) / s
      push(`${sectionId}-end`, bottom, '')
      // Legacy synthetic ends (`<legacy>-end`), unless the map already aliased them.
      const aliased = legacyOf.get(`${sectionId}-end`) ?? []
      for (const legacy of legacyOf.get(sectionId) ?? []) {
        if (!aliased.includes(`${legacy}-end`)) {
          positions.push({ sectionId: `${legacy}-end`, offsetY: bottom, headingText: '', legacy: true })
        }
      }
    }
  }
  return positions
}

/**
 * Live paper-y of a section's top, measured against `originEl` (the element
 * whose top is paper-y 0 for strokes — the canvas wrapper, i.e. the canvas's
 * offsetParent). Returns null when the section or #paper is not in the DOM.
 * Accepts current and legacy ids ({@link findSectionElement}).
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
  const sectionEl = findSectionElement(sectionId)
  const paperEl = document.getElementById('paper')
  if (!sectionEl || !paperEl) return null
  const liveScale = paperEl.getBoundingClientRect().width / paperEl.offsetWidth || 1
  const origin = originEl ?? paperEl
  return (sectionEl.getBoundingClientRect().top - origin.getBoundingClientRect().top) / liveScale
}
