'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { usePrintLayoutVersion } from '@/lib/print/print-mode'
import { applyPrintEdit, usePrintEditState } from '@/lib/print/print-edit-state'
import { insertPageBreak, removePageBreak } from '@/lib/print/print-edits'

/**
 * Page-break editing in the print preview ("Edit layout", print-view.tsx):
 * the top edge of the top-level block nearest the pointer (by height) shows
 * "+ Page break"; every
 * <pagebreak /> shows "Page break ×". Both edit the source via
 * print-edits.ts. Portalled into #paper and positioned absolutely, outside
 * .markdown-content, so the paginator's measurements don't see it; hidden in
 * actual print (print:hidden).
 *
 * Line of a block: its data-source-line-start, else the line after the
 * directly preceding block's data-source-line-end (blocks rendered without
 * source lines, e.g. <solution>, <hr>); no "+" when neither has one. Blocks
 * directly after a page break or a forced page start get no "+" either.
 *
 * Positions and lines are only valid for the layout pass they were measured
 * in (`layout`); a hover from an older pass is not shown. Clicks are disabled
 * while saving, which lasts until the refreshed page has rendered
 * (print-edit-state.ts), so lines never come from a stale DOM.
 */

interface Spot { top: number; line: number; layout?: number }

function paperGeometry(paper: HTMLElement) {
  const rect = paper.getBoundingClientRect()
  // Narrow screens scale the paper with a transform (--paper-scale).
  const scale = paper.offsetWidth ? rect.width / paper.offsetWidth : 1
  return { rect, scale }
}

function blockLine(block: Element): number | null {
  const own = Number(block.getAttribute('data-source-line-start'))
  if (own > 0) return own
  // Skip only the paginator's own gaps; any other block in between has
  // unknown lines.
  let prev = block.previousElementSibling
  while (prev?.classList.contains('print-gap')) prev = prev.previousElementSibling
  const end = Number(prev?.getAttribute('data-source-line-end'))
  return end > 0 ? end + 1 : null
}

function isBreakish(el: Element | null): boolean {
  return !!el && (el.classList.contains('print-gap') || !!el.querySelector(':scope > .print-pagebreak') || el.classList.contains('print-pagebreak'))
}

export function PrintEditOverlay() {
  const { saving } = usePrintEditState()
  const layout = usePrintLayoutVersion()
  // Client only: PrintView renders this after mount, in the print preview.
  const paper = typeof document !== 'undefined' ? document.getElementById('paper') : null
  const [hover, setHover] = useState<Spot | null>(null)

  // Existing page breaks, re-measured after every pagination pass (`layout`).
  const breaks = useMemo(() => {
    const list: Spot[] = []
    if (!paper) return list
    const { rect, scale } = paperGeometry(paper)
    for (const el of paper.querySelectorAll<HTMLElement>('.markdown-content .print-pagebreak[data-source-line-start]')) {
      list.push({ top: (el.getBoundingClientRect().top - rect.top) / scale, line: Number(el.dataset.sourceLineStart) })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layout: re-measure after pagination
  }, [paper, layout])

  useEffect(() => {
    if (!paper) return
    const content = paper.querySelector('.markdown-content')
    if (!content) return
    // The line goes to the block edge nearest the pointer's height, wherever
    // it is horizontally, so the pill on the left margin stays reachable.
    // O(blocks) per pointermove.
    const onMove = (e: PointerEvent) => {
      // A button held = dragging a handle: no page-break line across it.
      if (e.buttons) { setHover(null); return }
      const target = e.target as Element | null
      if (target?.closest('[data-print-edit-overlay]')) return
      const { rect, scale } = paperGeometry(paper)
      const y = (e.clientY - rect.top) / scale
      let best: Spot | null = null
      for (const block of content.children) {
        if (block === content.firstElementChild || block.classList.contains('print-gap') || isBreakish(block.previousElementSibling)) continue
        const r = block.getBoundingClientRect()
        if (!r.height) continue
        const top = (r.top - rect.top) / scale
        if (best && Math.abs(top - y) >= Math.abs(best.top - y)) continue
        const line = blockLine(block)
        if (line) best = { top, line, layout }
      }
      setHover(best)
    }
    const onLeave = () => setHover(null)
    paper.addEventListener('pointermove', onMove)
    paper.addEventListener('pointerleave', onLeave)
    return () => {
      paper.removeEventListener('pointermove', onMove)
      paper.removeEventListener('pointerleave', onLeave)
    }
  }, [paper, layout])

  if (!paper) return null
  const pill = 'pointer-events-auto absolute left-4 -translate-y-1/2 flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-sm disabled:opacity-50'
  return createPortal(
    <div data-print-edit-overlay="" className="print:hidden pointer-events-none absolute inset-0 z-30">
      {hover && hover.layout === layout && !breaks.some((b) => b.line === hover.line) && (
        <div className="absolute left-0 right-0 border-t border-dashed border-primary/60" style={{ top: hover.top }}>
          <button
            type="button"
            disabled={saving}
            onClick={() => { const line = hover.line; setHover(null); void applyPrintEdit((c) => insertPageBreak(c, line)) }}
            className={`${pill} border-primary bg-background text-primary hover:bg-primary/10`}
            title="Start a new printed page here"
          >
            <Plus className="h-3 w-3" /> Page break
          </button>
        </div>
      )}
      {breaks.map((b) => (
        <div key={b.line} className="absolute left-0 right-0 border-t-2 border-dashed border-primary" style={{ top: b.top }}>
          <button
            type="button"
            disabled={saving}
            onClick={() => void applyPrintEdit((c) => removePageBreak(c, b.line))}
            className={`${pill} border-primary bg-primary text-primary-foreground hover:bg-primary/90`}
            title="Remove this page break"
          >
            Page break <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>,
    paper,
  )
}
