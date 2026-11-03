/**
 * Print geometry. The paper is 1280px wide with 192px side padding
 * (POSITIONING.md), so the text column is 896px. In print the side padding
 * shrinks to 48px and the resulting 992px are zoomed onto the A4 text width:
 * the text column keeps its width (same line breaks as on screen) and the
 * section-anchored strokes move with it. Strokes further than 48px into the
 * margin are cut off. One printed page holds a fixed height of paper pixels.
 * Keep in sync with the print rules in globals.css (.print-layout).
 */
export const PAPER_WIDTH_PX = 992
/** A4 210mm minus 15mm left and right margins. */
export const PRINT_WIDTH_MM = 180
/** A4 297mm minus 15mm top and 18mm bottom (page number) margins. */
export const PRINT_HEIGHT_MM = 264
export const PAPER_PX_PER_MM = PAPER_WIDTH_PX / PRINT_WIDTH_MM
/** Paper pixels per printed page, about 1455. */
export const PAGE_HEIGHT_PX = PRINT_HEIGHT_MM * PAPER_PX_PER_MM
/**
 * Tallest spacer print height: 80% of a page (about 21cm), so a spacer still
 * fits on one page together with its heading and task text.
 */
export const MAX_SPACER_PRINT_PX = PAGE_HEIGHT_PX * 0.8

/**
 * Print height as written in markdown or typed into the spacer gizmo → paper
 * pixels; undefined when unparseable. A bare number is centimetres ("6"),
 * "6cm", "6 cm", "6,5cm", "60mm" and "400px" are accepted too.
 */
export function parsePrintLength(value: string | undefined): number | undefined {
  const m = value?.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(cm|mm|px)?$/i)
  if (!m) return undefined
  const n = Number(m[1])
  const unit = (m[2] ?? 'cm').toLowerCase()
  return unit === 'cm' ? n * 10 * PAPER_PX_PER_MM : unit === 'mm' ? n * PAPER_PX_PER_MM : n
}

/** Normalized spelling for the markdown attribute: centimetres, at most 1 decimal ("6.5cm"). */
export function formatPrintLengthCm(px: number): string {
  return `${Math.round((px / PAPER_PX_PER_MM / 10) * 10) / 10}cm`
}
