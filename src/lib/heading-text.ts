/**
 * Plain text of a rendered heading, for navigation labels (reading-progress bar).
 *
 * `textContent`/`innerText` of a rendered heading is wrong in two cases:
 * - KaTeX emits MathML (incl. a TeX <annotation>) plus an aria-hidden HTML
 *   rendering, so `$a$` reads «aaa».
 * - ColorTitleHeading (h1) renders its children twice (aria-hidden rainbow
 *   shadow + foreground), so «Titel» reads «TitelTitel».
 * We drop every aria-hidden subtree and every <annotation>, i.e. we read what a
 * screen reader reads. Math thus becomes its MathML text (`x^2` → «x2»).
 * Clones the element: O(size of heading).
 */
export function headingText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('[aria-hidden="true"], annotation').forEach((n) => n.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}
