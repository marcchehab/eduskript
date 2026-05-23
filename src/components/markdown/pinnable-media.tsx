'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoveDiagonal2 } from 'lucide-react'
import { useZoom } from '@/contexts/zoom-context'

/**
 * PinnableMedia — docks a video to the paper's right edge as you read past it.
 *
 * The element stays in `<main>` the whole time (never reparented → the iframe
 * never reloads). Pinning is done purely with `transform`, which doesn't affect
 * layout, so the original slot stays reserved. Living inside the zoomed
 * `<main>`, zoom is handled by dividing the translate by the live zoom factor;
 * the scale uses on-screen widths so zoom cancels there.
 *
 * Behaviour:
 *  - In flow normally.
 *  - Once the element's top edge reaches the viewport's top edge, it pins: the
 *    top edge locks to the viewport top (follows the reader) and it shrinks so
 *    its right edge sits at the paper's right edge, sized to a fraction of the
 *    paper width.
 *  - A round handle at the pinned player's bottom-left lets the user resize it
 *    (width drives the size; height follows the aspect ratio). The chosen width
 *    fraction is persisted in localStorage (local only, not synced).
 *  - The vacated slot shows a labelled grey placeholder; the footer (coupling
 *    toggle) is moved beneath the pinned player at readable size.
 *
 * `enabled` false is a transparent passthrough.
 */

const DEFAULT_WIDTH_FRACTION = 1 / 3 // pinned width = this × the paper width
const MIN_WIDTH_FRACTION = 0.15
const MAX_WIDTH_FRACTION = 1
const TOP_MARGIN = 8
const FOOTER_GAP = 8
const WIDTH_KEY = 'pinnable-media:width-fraction'

function clampFraction(f: number): number {
  return Math.min(MAX_WIDTH_FRACTION, Math.max(MIN_WIDTH_FRACTION, f))
}

export function PinnableMedia({
  enabled,
  footer,
  children,
}: {
  enabled?: boolean
  footer?: ReactNode
  children: ReactNode
}) {
  const slotRef = useRef<HTMLSpanElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  const footerRef = useRef<HTMLSpanElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const getZoom = useZoom()
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  const widthFractionRef = useRef(DEFAULT_WIDTH_FRACTION)
  const scheduleRef = useRef<() => void>(() => {})
  const draggingRef = useRef(false)

  // Restore the persisted width on mount (local only).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = parseFloat(window.localStorage.getItem(WIDTH_KEY) ?? '')
    if (!Number.isNaN(v)) widthFractionRef.current = clampFraction(v)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const sc = document.getElementById('scroll-container')
    let raf: number | null = null

    const clear = () => {
      for (const el of [innerRef.current, footerRef.current, handleRef.current]) {
        if (!el) continue
        el.style.transform = ''
        el.style.transformOrigin = ''
      }
      if (innerRef.current) {
        innerRef.current.style.position = ''
        innerRef.current.style.zIndex = ''
      }
      if (footerRef.current) {
        footerRef.current.style.position = ''
        footerRef.current.style.zIndex = ''
      }
    }

    const update = () => {
      raf = null
      const slot = slotRef.current
      const inner = innerRef.current
      if (!slot || !inner) return

      // Slot is never transformed → reports the media's natural on-screen rect.
      const a = slot.getBoundingClientRect()
      const scRect = sc?.getBoundingClientRect()
      const vpTop = scRect?.top ?? 0

      // Pin once the element's top edge reaches the viewport's top edge.
      const shouldPin = a.height > 0 && a.top <= vpTop + TOP_MARGIN
      if (shouldPin !== pinnedRef.current) {
        pinnedRef.current = shouldPin
        setPinned(shouldPin)
      }
      if (!shouldPin) {
        if (inner.style.transform) clear()
        return
      }

      const z = getZoom() || 1
      const paper = document.getElementById('paper')
      const pRect = paper && paper.offsetWidth > 0 ? paper.getBoundingClientRect() : scRect
      const paperRight = pRect?.right ?? window.innerWidth
      const paperWidth = pRect?.width ?? window.innerWidth

      const targetWidth = paperWidth * widthFractionRef.current // on-screen px
      const scale = targetWidth / a.width
      const scaledHeight = a.height * scale
      const targetLeft = paperRight - targetWidth // right edge at the paper's right edge
      const targetTop = vpTop + TOP_MARGIN // top edge at the viewport top

      // Local translate is pre-ancestor-scale, so divide on-screen deltas by z.
      inner.style.transformOrigin = 'top left'
      inner.style.transform = `translate(${(targetLeft - a.left) / z}px, ${(targetTop - a.top) / z}px) scale(${scale})`
      inner.style.position = 'relative'
      inner.style.zIndex = '50'

      // Counter-scale the handle so it stays a fixed size at the player's
      // bottom-left corner regardless of the player's scale.
      if (handleRef.current) {
        handleRef.current.style.transformOrigin = 'bottom left'
        handleRef.current.style.transform = `scale(${1 / scale})`
      }

      const ftr = footerRef.current
      if (ftr) {
        const footerCenterX = targetLeft + targetWidth / 2
        const naturalCenterX = a.left + a.width / 2
        const tx = (footerCenterX - naturalCenterX) / z
        const ty = (targetTop + scaledHeight + FOOTER_GAP - a.bottom) / z
        ftr.style.transformOrigin = 'top left'
        ftr.style.transform = `translate(${tx}px, ${ty}px)`
        ftr.style.position = 'relative'
        ftr.style.zIndex = '50'
      }
    }

    const schedule = () => {
      if (raf === null) raf = requestAnimationFrame(update)
    }
    scheduleRef.current = schedule

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('wheel', schedule, { passive: true })
    window.addEventListener('touchmove', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    sc?.addEventListener('scroll', schedule, { passive: true })
    schedule()
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('wheel', schedule)
      window.removeEventListener('touchmove', schedule)
      window.removeEventListener('resize', schedule)
      sc?.removeEventListener('scroll', schedule)
      if (raf !== null) cancelAnimationFrame(raf)
      clear()
    }
  }, [enabled, getZoom])

  // The handle only mounts once `pinned` flips true, which is after the
  // update() that set it — re-run layout so the handle gets counter-scaled.
  useEffect(() => {
    if (pinned) scheduleRef.current()
  }, [pinned])

  // --- Resize handle drag (width fraction; right edge stays anchored) ---
  const onHandlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const paper = document.getElementById('paper')
    const pRect = paper?.getBoundingClientRect()
    if (!pRect || pRect.width <= 0) return
    // Right edge is fixed at the paper's right edge; width grows as the handle
    // is dragged left.
    const onScreenWidth = pRect.right - e.clientX
    widthFractionRef.current = clampFraction(onScreenWidth / pRect.width)
    scheduleRef.current()
  }
  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WIDTH_KEY, String(widthFractionRef.current))
    }
  }

  if (!enabled) {
    return (
      <>
        {children}
        {footer}
      </>
    )
  }

  return (
    <>
      <span ref={slotRef} className="relative block">
        <span ref={innerRef} className="block">
          {children}
          {pinned && (
            <button
              ref={handleRef}
              type="button"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              title="Drag to resize"
              aria-label="Resize pinned video"
              className="absolute bottom-1 left-1 z-[60] flex h-7 w-7 items-center justify-center rounded-full border border-background/60 bg-foreground/85 text-background shadow-md"
              style={{ cursor: 'nesw-resize', touchAction: 'none' }}
            >
              <MoveDiagonal2 className="h-3.5 w-3.5 rotate-90" />
            </button>
          )}
        </span>
        {pinned && (
          <span
            className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/40 text-xs text-muted-foreground"
            onClick={() => slotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            Video pinned to the margin — click to jump back
          </span>
        )}
      </span>
      {footer != null && (
        <span ref={footerRef} className="block">
          {footer}
        </span>
      )}
    </>
  )
}
