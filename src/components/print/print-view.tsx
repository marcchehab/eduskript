'use client'

/**
 * Print view on the public page: a bar (solution mode, Print, Close), the
 * solutions at the end, and the paginator.
 *
 * Paginator: the screen layout IS the printed layout (same 896px text column,
 * the A4 text width in print), so annotations stay where students drew them.
 * Every PAGE_HEIGHT_PX of paper is one page. A top-level block that would
 * cross a page edge gets a gap div before it that pushes it to the next page;
 * a preceding heading or a block it keeps with (data-print-keep: solution
 * references) moves with it, and a section start (heading, code block,
 * callout, spacer…) up to 30% of a page earlier is preferred. <pagebreak />
 * (anywhere, also inside callouts) is filled up to the next page; two in a row
 * leave a blank page.
 *
 * In print, gaps and page breaks are forced breaks of height 0 (globals.css):
 * the screen layout and Chrome's print layout differ by fractions of a pixel
 * per bordered element (zoom snaps borders to device pixels), so heights alone
 * would drift over many pages; a forced break starts every page where the
 * screen shows it. Within a page that drift remains (SAFETY_PX).
 *
 * Gaps and page breaks carry data-print-online-height, so strokes anchored to a
 * section above a gap move with the text below it (src/lib/print/stroke-shift.ts).
 *
 * Blocks taller than 85% of a page are not moved but cut: the table row, code
 * line, list item or paragraph crossing a page edge starts the next page (a
 * stylesheet rule on screen, a forced break in print). Blocks holding an image
 * taller than half a page are moved instead, since Chrome cannot cut images.
 * O(blocks × gaps) layout reads; fine for a worksheet.
 *
 * @see src/lib/print/geometry.ts, src/lib/print/print-mode.ts, globals.css (.print-layout)
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { PrintEditOverlay } from '@/components/print/print-edit-overlay'
import { PrintPageQr } from '@/components/print/print-page-qr'
import { setPrintEditing, usePrintEditState, setPrintRepaginate } from '@/lib/print/print-edit-state'
import { FontSizeControls } from '@/components/public/font-size-controls'
import { bumpPrintLayout, initPrintFromUrl, setPrintState, usePrintState, type SolutionMode } from '@/lib/print/print-mode'
import { solutionLabel, useSolutionEntries } from '@/lib/print/solutions'
import { useCanEditPage } from '@/lib/print/can-edit'
import { PAGE_HEIGHT_PX } from '@/lib/print/geometry'
import { setCutMarkers, type CutMarker } from '@/lib/print/stroke-shift'

// Chrome lays out a few px longer under print zoom (about 0.5px per bordered
// element); a block ending this close to the edge is moved anyway.
const SAFETY_PX = 40
const SECTION_LOOKBACK = 0.3
const MAX_MOVABLE = 0.85

function isHeading(el: Element) {
  return /^H[1-4]$/.test(el.tagName) || (el.children.length === 1 && /^H[1-4]$/.test(el.firstElementChild?.tagName ?? ''))
}
function isSectionStart(el: Element) {
  return el.hasAttribute('data-section-id') || !!el.firstElementChild?.hasAttribute('data-section-id') || isHeading(el)
}
function keepsWithPrevious(el: Element) {
  return el.hasAttribute('data-print-keep') || !!el.firstElementChild?.hasAttribute('data-print-keep')
}

function blocksOf(paper: HTMLElement): HTMLElement[] {
  const roots = [paper.querySelector('.markdown-content'), paper.querySelector('.print-solutions')]
  return roots.flatMap((root) => root ? [...root.children] as HTMLElement[] : [])
    .filter((el) => !el.classList.contains('print-gap') && getComputedStyle(el).position !== 'absolute' && getComputedStyle(el).display !== 'none')
}

/** The element whose top shows where the content after `el` starts. */
function following(el: Element): Element | null {
  for (let n: Element | null = el; n && n.id !== 'paper'; n = n.parentElement) {
    if (n.nextElementSibling) return n.nextElementSibling
  }
  return null
}

// Elements a tall block is cut between: rows, code lines, list items, paragraphs.
const CUT_CANDIDATES = 'tr, .cm-line, li, p, h1, h2, h3, h4, pre, figure, img'
const CUT_STYLE_ID = 'print-cuts'

/** nth-child selector from #paper; for elements whose DOM we must not touch (CodeMirror lines). */
function cssPath(el: Element): string {
  const parts: string[] = []
  for (let n: Element | null = el; n && n.id !== 'paper'; n = n.parentElement) {
    parts.unshift(`:nth-child(${[...(n.parentElement?.children ?? [])].indexOf(n) + 1})`)
  }
  return `#paper > ${parts.join(' > ')}`
}

export function clearPagination(paper: HTMLElement) {
  paper.querySelectorAll('.print-gap, .print-page-edge').forEach((el) => el.remove())
  paper.querySelectorAll<HTMLElement>('.print-pagebreak').forEach((el) => {
    el.style.height = ''
    el.classList.remove('print-blank', 'print-noop')
    delete el.dataset.printOnlineHeight
  })
  document.getElementById(CUT_STYLE_ID)?.remove()
  setCutMarkers([])
}

export function paginate(paper: HTMLElement, pageHeight = PAGE_HEIGHT_PX) {
  clearPagination(paper)
  // Narrow screens scale the paper (--paper-scale); work in paper px.
  const scale = paper.getBoundingClientRect().width / paper.offsetWidth || 1
  // Page 1 starts at the paper's content top: print replaces the screen
  // padding with the page margin, so the padding is not part of page 1.
  // All y values below are relative to that point.
  const padTop = parseFloat(getComputedStyle(paper).paddingTop) || 0
  const top = (el: Element) => (el.getBoundingClientRect().top - paper.getBoundingClientRect().top) / scale - padTop
  const height = (el: Element) => el.getBoundingClientRect().height / scale
  // 1px tolerance: a block placed exactly on an edge measures a hair above it.
  const pageOf = (y: number) => Math.floor((y + 1) / pageHeight)

  // Gives `spacer` the height that makes the content after it start at the
  // next page edge, and records how far that content moved.
  // With min > 0 the spacer gets that height before measuring: empty, the
  // next block's top margin collapses through it and it measures too high.
  const fillTo = (spacer: HTMLElement, edge: number, min = 0) => {
    if (min > 0) spacer.style.height = `${min}px`
    const next = following(spacer)
    const before = next ? top(next) : 0
    spacer.style.height = `${Math.max(min, edge - top(spacer))}px`
    const moved = next ? top(next) - before : spacer.offsetHeight
    spacer.dataset.printOnlineHeight = String(spacer.offsetHeight - moved)
  }

  // Cuts inside blocks too tall to move: the row/line crossing a page edge
  // starts the next page, on screen by a margin (padding for table rows), in
  // print by a forced break, the way Chrome would push it anyway. Rules go into
  // a stylesheet instead of the elements: CodeMirror rewrites attributes of
  // its lines.
  const sheet = document.createElement('style')
  sheet.id = CUT_STYLE_ID
  document.head.appendChild(sheet)
  const cuts: CutMarker[] = []
  const addRule = (rule: string) => sheet.sheet?.insertRule(rule, sheet.sheet.cssRules.length)
  /**
   * Cuts `block` at the page edge `edgeY`. 'none': nothing to cut between;
   * 'move': the cut would fall on the block's first line, so the whole block
   * should move instead (Chrome won't break inside a first child's top
   * margin; it would carry the whole margin onto the next page).
   */
  const cutAt = (block: HTMLElement, edgeY: number): 'cut' | 'none' | 'move' => {
    let cut: Element | null = null
    for (const c of block.querySelectorAll(CUT_CANDIDATES)) {
      const ct = top(c)
      const ch = height(c)
      // Document order: the last straddling candidate is the innermost. One
      // taller than a page would only be pushed into the next edge. Ending
      // within SAFETY_PX above the edge counts as straddling: print runs
      // about 0.5px longer per table row, so such a row would not fit there.
      // Among siblings the FIRST one reaching into that band wins (a later
      // one would leave it alone on a page); a candidate inside it replaces
      // it (innermost).
      if (ct < edgeY - 1 && ct + ch > edgeY - SAFETY_PX && ch < pageHeight * MAX_MOVABLE && (!cut || cut.contains(c))) cut = c
    }
    if (!cut || cuts.some((c) => c.el.contains(cut)) || getComputedStyle(cut).display.startsWith('inline')) return 'none'
    if (cut === block.querySelector(CUT_CANDIDATES) || (cut.classList.contains('cm-line') && !cut.previousElementSibling)) return 'move'
    const path = cssPath(cut)
    const probe = following(cut) ?? cut
    const before = top(probe)
    if (cut.tagName === 'TR') {
      const cell = cut.firstElementChild
      const pad = cell ? parseFloat(getComputedStyle(cell).paddingTop) || 0 : 0
      addRule(`${path} > * { padding-top: ${pad + edgeY - top(cut)}px !important; }`)
      addRule(`@media print { ${path} { break-before: page; } ${path} > * { padding-top: ${pad}px !important; } }`)
    } else {
      const cutTop = top(cut)
      const mt = parseFloat(getComputedStyle(cut).marginTop) || 0
      // Target: the element's top at edge + its own margin, where the forced
      // break puts it in print. Margins may collapse with the previous
      // sibling's, so correct twice by the measured error.
      let value = mt + edgeY + mt - top(cut)
      let lastErr = Infinity
      for (let pass = 0; pass < 3; pass++) {
        if (pass > 0) sheet.sheet?.deleteRule(sheet.sheet.cssRules.length - 1)
        addRule(`${path} { margin-top: ${value}px !important; }`)
        const err = edgeY + mt - top(cut)
        if (Math.abs(err) < 0.5 || Math.abs(err) >= Math.abs(lastErr)) break
        lastErr = err
        value += err
      }
      if (cut.classList.contains('cm-line')) {
        // Code lines keep the screen margin in print (no forced break): the
        // code block's height then includes the space at the page edge, so
        // its last lines aren't pushed out of the frame. Chrome breaks
        // inside that margin and drops the rest of it.
        // The line numbers are a separate column: the number at the same
        // height gets the same shift, or every number below is off by one.
        const delta = top(cut) - cutTop
        const editor = cut.closest('.cm-editor')
        for (const g of editor?.querySelectorAll('.cm-gutterElement') ?? []) {
          if (Math.abs(top(g) - cutTop) > 2) continue
          const gm = parseFloat(getComputedStyle(g).marginTop) || 0
          addRule(`${cssPath(g)} { margin-top: ${gm + delta}px !important; }`)
        }
      } else {
        addRule(`@media print { ${path} { margin-top: ${mt}px !important; break-before: page; } }`)
      }
    }
    const moved = top(probe) - before
    // A row's top stays, its content moves; other elements move themselves.
    cuts.push({ el: cut as HTMLElement, shift: moved, atOffset: cut.tagName === 'TR' ? 0 : -moved })
    return 'cut'
  }

  /**
   * A block whose top margin straddles a page edge with nothing forcing the
   * break: Chrome truncates the margin at the break, so the block starts at
   * the page top in print. Shrink the margin (screen and print alike) so the
   * preview shows it there too. The margin may sit on a first child (heading
   * in a section wrapper); corrected by measurement, up to 3 passes.
   */
  const pullToEdge = (el: HTMLElement, edgeY: number) => {
    const mtOf = (n: Element) => parseFloat(getComputedStyle(n).marginTop) || 0
    const before = top(el)
    // The gap is the collapsed max(previous bottom margin, own top margin):
    // drop the previous block's bottom margin (and its last children's) first.
    let prev = el.previousElementSibling
    while (prev && height(prev) === 0) prev = prev.previousElementSibling
    // Stops at a box with bottom padding/border: margins inside it don't
    // collapse outward (a callout's last paragraph).
    for (let n: Element | null = prev, d = 0; n && d < 3; d++) {
      const cs = getComputedStyle(n)
      if ((parseFloat(cs.marginBottom) || 0) > 0) addRule(`${cssPath(n)} { margin-bottom: 0px !important; }`)
      if ((parseFloat(cs.paddingBottom) || 0) > 0 || (parseFloat(cs.borderBottomWidth) || 0) > 0) break
      n = n.lastElementChild
    }
    const chain: Element[] = [el]
    while (chain.length < 3 && chain[chain.length - 1].firstElementChild) chain.push(chain[chain.length - 1].firstElementChild!)
    const target = chain.reduce((a, b) => (mtOf(b) > mtOf(a) ? b : a))
    let value = mtOf(target) - (top(el) - edgeY)
    const path = cssPath(target)
    for (let pass = 0; pass < 3; pass++) {
      if (pass > 0) sheet.sheet?.deleteRule(sheet.sheet.cssRules.length - 1)
      addRule(`${path} { margin-top: ${Math.max(0, value)}px !important; }`)
      const err = top(el) - edgeY
      if (Math.abs(err) < 0.5 || value <= 0) break
      value -= err
    }
    const moved = top(el) - before
    // Stroke markers only: kept out of `cuts`, whose entries block cuts inside them.
    if (Math.abs(moved) >= 0.5) pulls.push({ el, shift: moved, atOffset: -moved })
  }
  const pulls: CutMarker[] = []
  /**
   * Whether a forced break (gap or page break) precedes `el`, ignoring empty
   * blocks in between; from the start of the Solutions list it continues at
   * the end of the page content.
   */
  const forcedBefore = (el: Element) => {
    const scan = (from: Element | null) => {
      for (let prev = from; prev; prev = prev.previousElementSibling) {
        if (prev.classList.contains('print-gap') || prev.matches('.print-pagebreak:not(.print-noop)') || prev.querySelector('.print-pagebreak:not(.print-noop)')) return true
        if (height(prev) > 0) return false
      }
      return null
    }
    const r = scan(el.previousElementSibling)
    if (r !== null) return r
    return el.parentElement === roots[1] && !!roots[0] && !!scan(roots[0].lastElementChild)
  }

  const roots = [paper.querySelector('.markdown-content'), paper.querySelector('.print-solutions')]
  /** Whether any content with height follows `el` (O(following siblings)). */
  const contentAfter = (el: Element): boolean => {
    for (let n: Element | null = el; n && !roots.includes(n); n = n.parentElement) {
      for (let sib = n.nextElementSibling; sib; sib = sib.nextElementSibling) if (height(sib) > 0) return true
    }
    const solutions = roots[1]
    return !!solutions && !solutions.contains(el) && height(solutions) > 0
  }

  let lastContentBottom = -1
  let lastBreakEnd = -1
  let blocks = blocksOf(paper)
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i]

    const breaks = el.classList.contains('print-pagebreak') ? [el] : [...el.querySelectorAll<HTMLElement>('.print-pagebreak')]
    if (breaks.length) {
      for (const pb of breaks) {
        // A break with nothing after it would only print an empty last page.
        const last = !contentAfter(pb)
        const t = top(pb)
        const pageTop = pageOf(t) * pageHeight
        // min 1px: an empty break lets the next block's top margin collapse
        // through it, so it would measure (and fill) too short.
        if (last) {
          pb.classList.add('print-noop')
        } else if (lastBreakEnd > lastContentBottom && Math.abs(t - lastBreakEnd) < 2) {
          // Second break in a row: a blank page.
          pb.classList.add('print-blank')
          fillTo(pb, pageTop + pageHeight, 1)
        } else if (lastContentBottom <= pageTop + 1) {
          // Nothing on this page yet: no break (Chrome would not break either).
          pb.classList.add('print-noop')
        } else {
          fillTo(pb, pageTop + pageHeight, 1)
        }
        lastBreakEnd = top(pb) + height(pb)
      }
      lastContentBottom = Math.max(lastContentBottom, ...[...el.children].filter((c) => !c.classList.contains('print-pagebreak') && height(c) > 0).map((c) => top(c) + height(c)))
      continue
    }

    let t = top(el)
    const h = height(el)
    if (h === 0) continue
    const page = pageOf(t)
    if (page > 0 && t - page * pageHeight > 0.5 && lastContentBottom >= 0 && lastContentBottom < page * pageHeight - 0.5 && !forcedBefore(el)) {
      pullToEdge(el, page * pageHeight)
      t = top(el)
    }
    const edge = (page + 1) * pageHeight - SAFETY_PX
    // Tall blocks are cut, unless they hold a tall image or embed, which Chrome
    // cannot cut and would move to the next page anyway.
    const tall = h > pageHeight * MAX_MOVABLE
    const tallMedia = tall && [...el.querySelectorAll('img, svg, video, canvas, iframe')].some((m) => height(m) > pageHeight / 2)
    const tooTall = tall && !tallMedia
    // At the page top already: fine, unless too tall (then cut below).
    if (t + h <= edge || (t - page * pageHeight < 2 && !tooTall)) {
      lastContentBottom = t + h
      continue
    }
    if (tooTall) {
      let cutAny = false
      let moveWhole = false
      for (let k = page + 1; k * pageHeight < top(el) + height(el); k++) {
        const r = cutAt(el, k * pageHeight)
        if (r === 'move') { moveWhole = true; break }
        cutAny = cutAny || r === 'cut'
      }
      // A tall KaTeX block (nothing inside to cut between, not split by
      // Chrome) moves to the next page whole, so move it here too; so does a
      // block whose first line would be cut. Other blocks without candidates
      // (long paragraphs) Chrome splits between lines; left as they are, the
      // preview can be off by up to one line.
      if (!moveWhole && (cutAny || !el.querySelector('.katex-display'))) {
        lastContentBottom = top(el) + height(el)
        continue
      }
    }

    let target = i
    // A tall image must itself start the page (Chrome moves it there anyway),
    // so its heading cannot come along.
    while (!tallMedia && target > 0 && top(blocks[target - 1]) > page * pageHeight + 2 &&
      (isHeading(blocks[target - 1]) || keepsWithPrevious(blocks[target]))) target--
    if (!tallMedia && !isSectionStart(blocks[target])) {
      for (let j = target - 1; j >= 0 && top(blocks[j]) > edge - pageHeight * SECTION_LOOKBACK; j--) {
        if (top(blocks[j]) <= page * pageHeight + 2) break
        if (isSectionStart(blocks[j])) { target = j; break }
      }
    }
    // Nothing before it on this page: moving would only leave the page empty
    // (Chrome ignores a forced break there and splits the block instead).
    const before = blocks.slice(0, target).filter((b) => height(b) > 0).pop()
    // Cut it at the edge instead where it has rows/lines to cut between.
    if (!before || top(before) + height(before) <= page * pageHeight + 1) {
      cutAt(el, (page + 1) * pageHeight)
      lastContentBottom = top(el) + height(el)
      continue
    }
    // Already moved to this page start: it does not fit on any page.
    if (blocks[target].previousElementSibling?.classList.contains('print-gap')) {
      lastContentBottom = t + h
      continue
    }
    const gap = document.createElement('div')
    gap.className = 'print-gap'
    gap.setAttribute('aria-hidden', 'true')
    blocks[target].before(gap)
    // At least 1px: an empty 0px div lets the margins above and below collapse.
    fillTo(gap, (page + 1) * pageHeight, 1)
    blocks = blocksOf(paper)
    // Process the moved block again (now at the page start), so
    // lastContentBottom knows the new page has content.
    i = target - 1
  }
  setCutMarkers([...cuts, ...pulls])

  // Page edges on screen only (print:hidden via .print-page-edge), up to the
  // last content: the paper's bottom padding and min-height don't print.
  const total = Math.max(0, ...blocksOf(paper).filter((b) => height(b) > 0).map((b) => top(b) + height(b)))
  for (let k = 1; k * pageHeight < total - 1; k++) {
    const edge = document.createElement('div')
    edge.className = 'print-page-edge'
    edge.style.top = `${padTop + k * pageHeight}px`
    edge.dataset.page = String(k + 1)
    paper.appendChild(edge)
  }
}

const noopSubscribe = () => () => {}

function PrintSolutions() {
  const entries = useSolutionEntries()
  if (entries.length === 0) return null
  return (
    <div className="print-solutions prose-theme px-0">
      <span className="print-pagebreak" data-pagebreak="" aria-hidden="true" />
      <h2>Solutions</h2>
      {entries.map((e, i) => (
        <div key={e.id} className="my-4">
          {e.heading
            ? <div className="mb-1 mt-6 font-semibold">{e.heading.current}</div>
            : <h3 className="mb-1 mt-6 text-lg font-bold">{solutionLabel(entries, e.id)}</h3>}
          <div>{e.content.current}</div>
        </div>
      ))}
    </div>
  )
}

const MODE_LABELS: Record<SolutionMode, string> = {
  online: 'As online',
  all: 'All',
  none: 'None',
}

function scrollToTop() {
  document.getElementById('scroll-container')?.scrollTo(0, 0)
  window.scrollTo(0, 0)
}

/**
 * Mounted once in the public layout (layout.tsx), so every page with a
 * Print button has it — frontpages included (2026-11-03: they had none, the
 * button switched to print mode with no bar to leave it). The solutions list
 * is portalled to the end of #paper.
 */
export function PrintView({ pageId }: { pageId?: string }) {
  const { active, solutions } = usePrintState()
  const canEdit = useCanEditPage(pageId, active)
  const entries = useSolutionEntries()
  // False during SSR and hydration, true on the client: the bar is a portal into body.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)

  useEffect(() => {
    initPrintFromUrl()
  }, [])

  const edit = usePrintEditState()

  // Re-paginate whenever the content settles (fonts, images, editors loading).
  // While a mouse button is held (dragging a layout handle) nothing runs; on
  // release it runs at once instead of after the debounce. After a layout
  // edit's refresh (edit.revision) it runs again in place, without tearing
  // the pagination down first: a new <pagebreak /> has no height of its own,
  // so the ResizeObserver alone wouldn't notice it. paginate() clears and
  // re-lays out in one task, so each run is one paint.
  const runNow = useRef<(() => void) | null>(null)
  useEffect(() => {
    const paper = document.getElementById('paper')
    if (!active || !paper) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastHeight = -1
    let busy = false
    let pressed = false
    const run = () => {
      if (timer) clearTimeout(timer)
      timer = null
      busy = true
      paginate(paper)
      lastHeight = paper.querySelector('.markdown-content')?.getBoundingClientRect().height ?? 0
      bumpPrintLayout()
      requestAnimationFrame(() => { busy = false })
    }
    const changed = () => {
      const h = paper.querySelector('.markdown-content')?.getBoundingClientRect().height ?? 0
      return Math.abs(h - lastHeight) >= 1
    }
    const schedule = () => {
      // Printing re-lays out with zoom (print media); the gaps computed on screen must stay.
      if (busy || pressed || window.matchMedia('print').matches || !changed()) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, 400)
    }
    const onDown = () => { pressed = true }
    const onUp = () => {
      pressed = false
      if (changed()) requestAnimationFrame(run)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    const observer = new ResizeObserver(schedule)
    const content = paper.querySelector('.markdown-content')
    if (content) observer.observe(content)
    const first = setTimeout(run, 300)
    runNow.current = run
    setPrintRepaginate(run)
    return () => {
      runNow.current = null
      setPrintRepaginate(null)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      observer.disconnect()
      clearTimeout(first)
      if (timer) clearTimeout(timer)
      clearPagination(paper)
      bumpPrintLayout()
    }
  }, [active, entries.length])
  useEffect(() => {
    if (edit.revision) runNow.current?.()
  }, [edit.revision])

  const canEditLayout = canEdit && !!edit.content && edit.pageId === pageId
  // Layout handles are on whenever an editor has the preview open.
  useEffect(() => {
    setPrintEditing(active && canEditLayout)
  }, [active, canEditLayout])

  const close = () => {
    // Keep the reading position: the print layout is taller (gaps, tab
    // copies, fallbacks), so the same scrollTop online lands elsewhere or
    // below the paper. Re-anchor on the first top-level block in view.
    const scroller = document.getElementById('scroll-container')
    const top = scroller?.getBoundingClientRect().top ?? 0
    const anchor = [...(document.querySelector('#paper .markdown-content')?.children ?? [])]
      .find((el) => !el.classList.contains('print-gap') && el.getBoundingClientRect().bottom > top)
    const offset = anchor ? anchor.getBoundingClientRect().top - top : 0
    setPrintState({ active: false, solutions: 'online' })
    if (anchor && scroller) {
      // Re-anchor every frame for a moment: the online layout settles over
      // a few frames (CSS transitions on the scroll container, ~300ms).
      // Stops early when the reader scrolls.
      const until = performance.now() + 600
      let stopped = false
      const stop = () => { stopped = true }
      scroller.addEventListener('wheel', stop, { once: true, passive: true })
      scroller.addEventListener('touchstart', stop, { once: true, passive: true })
      const step = () => {
        if (stopped || !anchor.isConnected) return
        scroller.scrollTop += anchor.getBoundingClientRect().top - top - offset
        if (performance.now() < until) requestAnimationFrame(step)
        else { scroller.removeEventListener('wheel', stop); scroller.removeEventListener('touchstart', stop) }
      }
      requestAnimationFrame(step)
    }
    const url = new URL(window.location.href)
    if (url.searchParams.has('print')) {
      url.searchParams.delete('print')
      window.history.replaceState(null, '', url)
    }
  }

  // Esc leaves the print view.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!active || !mounted) return null
  const paper = document.getElementById('paper')
  return (
    <>
      {paper && createPortal(<PrintSolutions />, paper)}
      <PrintPageQr />
      {canEditLayout && edit.editing && <PrintEditOverlay />}
      {createPortal(
        <div className="print-bar fixed left-1/2 top-4 z-[60] flex w-max max-w-[calc(100vw-1rem)] font-sans -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg">
          <span className="font-medium">Print preview (A4)</span>
          <FontSizeControls />
          {canEdit && (
            <label
              className="flex items-center gap-1.5"
              title="As online: the solutions a student sees on this page. All: also those hidden online (exam pages, quizzes without feedback). None: a student copy without solutions."
            >
              Solutions
              <select
                value={solutions}
                onChange={(e) => setPrintState({ solutions: e.target.value as SolutionMode })}
                className="rounded border border-border bg-background px-1 py-0.5"
              >
                {(Object.keys(MODE_LABELS) as SolutionMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
              </select>
            </label>
          )}
          {/* Below the bar, not in it: no shift either. */}
          {edit.error && <span className="absolute left-1/2 top-full mt-2 w-max max-w-md -translate-x-1/2 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs text-destructive shadow-md">{edit.error}</span>}
          <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded bg-primary px-2.5 py-1 text-primary-foreground">
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
          <button type="button" onClick={close} title="Close print preview (Esc)" className="flex items-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" /> Close
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * Floating-controls button that opens the print view. Reading mode is
 * overridden while the view is open (use-reflow-mode.ts), not switched off.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => { setPrintState({ active: true }); scrollToTop() }}
      className="p-2 rounded-md border border-border bg-card hover:bg-muted transition-colors"
      title="Print or save as PDF"
    >
      <Printer className="w-4 h-4 text-foreground" />
    </button>
  )
}
