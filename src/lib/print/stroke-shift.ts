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
 * O(sections × markers); markers are few (about one per page, plus
 * print-only elements).
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
  return list.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}
