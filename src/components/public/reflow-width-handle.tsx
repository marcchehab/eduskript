'use client'

import { useRef } from 'react'
import { MoveHorizontal } from 'lucide-react'

/**
 * Drag handle at the top-left edge of #paper that widens/narrows the reading
 * column in reflow mode. Always rendered; CSS (.reflow-width-handle in
 * globals.css) shows it only under html.reflow-mode on screens ≥ 640px.
 *
 * The column is centered, so dragging the left edge by dx changes the width by
 * 2·dx. The width is written to the --reflow-max-width CSS variable on <html>
 * and persisted in localStorage (local only); root-shell.tsx restores it
 * pre-paint. Double-click resets to the 48rem default.
 */
const WIDTH_KEY = 'eduskript-reflow-width'
const MIN_WIDTH = 480

function setWidth(px: number | null) {
  const root = document.documentElement
  if (px === null) root.style.removeProperty('--reflow-max-width')
  else root.style.setProperty('--reflow-max-width', `${px}px`)
}

export function ReflowWidthHandle() {
  const dragRef = useRef<{ center: number; width: number | null } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const paper = e.currentTarget.closest('#paper')
    if (!paper) return
    e.preventDefault()
    const r = paper.getBoundingClientRect()
    dragRef.current = { center: r.left + r.width / 2, width: null }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic/stale pointer id */
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const max = document.documentElement.clientWidth
    const w = Math.round(Math.min(max, Math.max(MIN_WIDTH, 2 * (drag.center - e.clientX))))
    drag.width = w
    setWidth(w)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (drag.width === null) return
    try {
      localStorage.setItem(WIDTH_KEY, String(drag.width))
    } catch {
      /* private mode — width still applies for this page view */
    }
  }

  const onDoubleClick = () => {
    setWidth(null)
    try {
      localStorage.removeItem(WIDTH_KEY)
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag to change column width (double-click to reset)"
      aria-label="Resize reading column"
      className="reflow-width-handle absolute left-0 top-6 z-30 h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
      style={{ cursor: 'ew-resize', touchAction: 'none' }}
    >
      <MoveHorizontal className="h-3.5 w-3.5" />
    </button>
  )
}
