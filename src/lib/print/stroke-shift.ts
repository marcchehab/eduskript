/**
 * Keeping strokes on their text in the print view.
 *
 * Strokes are anchored to sections ([data-section-id], section-anchored-
 * strokes.tsx) and sit at a fixed offset below the section top. The print
 * view changes heights inside sections: paginator gaps and page breaks
 * (print-view.tsx), print-only content, QR codes instead of videos, spacers
 * with a print height, extra tabs. Every such element carries
 * `data-print-online-height` = its height online (0 for things absent online).
 * Content below it moved by (current height − online height); a stroke whose
 * vertical centre lay below the element's online bottom moves by the same
 * amount. Strokes that span the element are moved or not as a whole. Cuts
 * inside blocks too tall to move (print-view.tsx) are registered as
 * CutMarkers below, since their elements may not carry attributes.
 *
 * Print CSS that changes heights without React (compact callouts,
 * globals.css .print-layout blockquote.callout) is measured once when the
 * print view opens: measureCssShifts, below.
 *
 * O(sections × markers); markers are few (about one per page, plus
 * print-only elements, plus a few per callout).
 */

export interface PrintShift {
  /** Section-local y (online layout) below which content moved. */
  at: number
  shift: number
}

/** Shifts for strokes anchored to `section`, from the markers after it. `scale`: rect px per layout px. */
export function printShiftsFor(section: Element, markers: CutMarker[], scale: number): PrintShift[] {
  const top = section.getBoundingClientRect().top
  const out: PrintShift[] = []
  let moved = 0
  for (const m of markers) {
    if (!(section.compareDocumentPosition(m.el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
    if (Math.abs(m.shift) < 0.5) continue
    // Offset of the marker in the online layout: its current offset minus
    // what earlier markers below the section added.
    const offset = (m.el.getBoundingClientRect().top - top) / scale - moved
    out.push({ at: offset + m.atOffset, shift: m.shift })
    moved += m.shift
  }
  return out
}

/** Vertical move for a stroke whose centre is `y` px below its section top (online). */
export function printShiftAt(shifts: PrintShift[] | undefined, y: number): number {
  let dy = 0
  for (const s of shifts ?? []) if (y > s.at) dy += s.shift
  return dy
}

/**
 * A cut inside a block too tall to move (print-view.tsx): content from `el`
 * on moved down by `shift`. `atOffset`: where that starts relative to el's
 * current top, minus the shift already applied (−shift for an element that
 * moved itself, 0 for a table row whose cells got padding).
 */
export interface CutMarker {
  el: HTMLElement
  shift: number
  atOffset: number
}

let cutMarkers: CutMarker[] = []

export function setCutMarkers(list: CutMarker[]) {
  cutMarkers = list
}

/** Markers for printShiftsFor: page-filling elements and cuts, in document order. */
export function collectPrintMarkers(root: Element): CutMarker[] {
  const list: CutMarker[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[data-print-online-height]')) {
    const online = Number(el.dataset.printOnlineHeight)
    if (!Number.isFinite(online)) continue
    list.push({ el, shift: el.offsetHeight - online, atOffset: online })
  }
  for (const c of cutMarkers) if (c.el.isConnected) list.push(c)
  for (const c of cssMarkers) if (c.el.isConnected) list.push(c)
  return list.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}

let cssMarkers: CutMarker[] = []

const docOrder = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)

/**
 * Run `apply` (switches the page to the print CSS, print-mode.ts) and register
 * a marker for every vertical move it causes in and around callouts, which
 * print compactly. Tracked per top-level callout: its previous sibling (or
 * parent), the callout, its title, the direct children of its content, its
 * next sibling. Each tracked element whose distance to the tracked element
 * before it changed gets a marker: content from its online top on moves by
 * that change.
 *
 * Measured synchronously around the class switch, before React re-renders
 * for print, so only CSS effects are seen (print-only content and the
 * paginator bring their own markers). Limitations: opened directly with
 * ?print the page was never laid out online, so nothing is measured; inside a
 * paragraph (different line breaks) and inside nested callouts only the
 * total at the next tracked element is right. O(callouts × children) reads.
 */
export function measureCssShifts(apply: () => void) {
  cssMarkers = []
  const callouts = [...document.querySelectorAll<HTMLElement>('blockquote.callout')]
    .filter((c) => !c.parentElement?.closest('blockquote.callout'))
  if (callouts.length === 0) {
    apply()
    return
  }
  const tracked = new Set<HTMLElement>()
  for (const c of callouts) {
    const prev = (c.previousElementSibling ?? c.parentElement) as HTMLElement | null
    if (prev) tracked.add(prev)
    tracked.add(c)
    const title = c.querySelector<HTMLElement>(':scope > .callout-title')
    if (title) tracked.add(title)
    const content = c.querySelector<HTMLElement>('.callout-content')
    if (content) for (const child of content.children) tracked.add(child as HTMLElement)
    const next = c.nextElementSibling as HTMLElement | null
    if (next) tracked.add(next)
  }
  const list = [...tracked].sort(docOrder)
  // Layout px, page coordinates; null = not rendered.
  const tops = () => {
    const ref = callouts[0]
    const scale = ref.offsetHeight ? ref.getBoundingClientRect().height / ref.offsetHeight : 1
    return list.map((el) => (el.getClientRects().length ? (el.getBoundingClientRect().top + window.scrollY) / (scale || 1) : null))
  }
  const before = tops()
  apply()
  const after = tops()

  let pred = -1
  for (let i = 0; i < list.length; i++) {
    const b = before[i], a = after[i]
    if (b == null || a == null) continue
    if (pred >= 0) {
      const shift = (a - after[pred]!) - (b - before[pred]!)
      if (Math.abs(shift) >= 0.5) cssMarkers.push({ el: list[i], shift, atOffset: -shift })
    }
    pred = i
  }
}

export function clearCssShifts() {
  cssMarkers = []
}
