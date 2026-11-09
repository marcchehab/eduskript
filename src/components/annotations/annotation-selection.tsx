'use client'

/**
 * Lasso-selection overlay: dashed box around the selected strokes, a move
 * gizmo, and an action bar (Delete / Duplicate / Done).
 *
 * Rendered inside the canvas wrapper that AnnotationLayer portals into
 * #paper, so positions are paper px (the stroke coordinate space) and the page
 * zoom transform applies. The controls are counter-scaled by `zoom` so they
 * keep a finger-sized hit area at any zoom.
 *
 * A transparent full-paper catcher sits under the box: the first tap outside
 * the selection only dismisses it (it does not also start a stroke).
 *
 * Dragging the box or the gizmo calls `onPreviewMove` (at most once per
 * frame) and `onCommitMove` once on release — the parent saves once per drag.
 * Delta = client delta / measured paper scale (paperRect.width / offsetWidth),
 * the same conversion as the line-edit handles in section-anchored-strokes.
 *
 * @see src/lib/annotations/selection.ts — gesture rules + stroke edits
 * @see annotation-layer.tsx — state, re-anchoring, persistence
 */

import { useEffect, useRef } from 'react'
import { Copy, Move, Trash2, X } from 'lucide-react'

export interface SelectionBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface AnnotationSelectionProps {
  bounds: SelectionBox
  zoom: number
  onPreviewMove: (delta: { dx: number; dy: number } | null) => void
  onCommitMove: (dx: number, dy: number) => void
  onDelete: () => void
  onDuplicate: () => void
  onDismiss: () => void
}

/** Padding around the strokes' bbox (paper px). */
const PAD = 8
/** A drag shorter than this (paper px) is a tap, not a move. */
const MIN_MOVE_PX = 1

export function AnnotationSelection({
  bounds,
  zoom,
  onPreviewMove,
  onCommitMove,
  onDelete,
  onDuplicate,
  onDismiss,
}: AnnotationSelectionProps) {
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const paperEl = document.getElementById('paper')
    const scale = paperEl && paperEl.offsetWidth > 0 ? paperEl.getBoundingClientRect().width / paperEl.offsetWidth : 1
    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    let latest = { dx: 0, dy: 0 }
    let raf: number | null = null

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      latest = { dx: (ev.clientX - startX) / scale, dy: (ev.clientY - startY) / scale }
      if (raf === null) {
        raf = requestAnimationFrame(() => {
          raf = null
          onPreviewMove(latest)
        })
      }
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      cleanup()
      if (ev.type === 'pointerup' && Math.hypot(latest.dx, latest.dy) >= MIN_MOVE_PX) {
        onCommitMove(latest.dx, latest.dy)
      }
      onPreviewMove(null)
    }
    const cleanup = () => {
      if (raf !== null) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      cleanupRef.current = null
    }
    cleanupRef.current?.()
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const left = bounds.minX - PAD
  const top = bounds.minY - PAD
  const width = bounds.maxX - bounds.minX + PAD * 2
  const height = bounds.maxY - bounds.minY + PAD * 2
  const inv = 1 / (zoom || 1)
  // Stop the canvas below from starting a stroke on button presses.
  const stop = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <>
      <div
        data-testid="selection-catcher"
        className="absolute inset-0"
        style={{ zIndex: 1001, touchAction: 'auto' }}
        onPointerDown={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
      />
      <div
        role="group"
        aria-label="Selected annotations"
        data-testid="selection-box"
        className="absolute rounded-sm border-2 border-dashed border-primary bg-primary/5"
        style={{ left, top, width, height, zIndex: 1002, cursor: 'move', touchAction: 'none' }}
        onPointerDown={startDrag}
      >
        {/* Action bar above the box, counter-scaled to stay readable/tappable. */}
        <div
          className="absolute left-0 flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-lg"
          style={{ bottom: '100%', marginBottom: 6 * inv, transform: `scale(${inv})`, transformOrigin: 'bottom left', cursor: 'default' }}
          onPointerDown={stop}
        >
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 rounded px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="flex items-center gap-1 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <Copy className="h-4 w-4" /> Duplicate
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Done"
            title="Done"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Move gizmo: centred below the box, 40 px (screen) round handle. */}
        <button
          type="button"
          aria-label="Move selection"
          title="Move selection"
          className="absolute flex items-center justify-center rounded-full border border-border bg-background text-foreground shadow-lg"
          style={{
            left: '50%',
            top: '100%',
            width: 40,
            height: 40,
            marginTop: 6 * inv,
            transform: `translateX(-50%) scale(${inv})`,
            transformOrigin: 'top center',
            cursor: 'move',
            touchAction: 'none',
          }}
          onPointerDown={startDrag}
        >
          <Move className="h-5 w-5" />
        </button>
      </div>
    </>
  )
}
