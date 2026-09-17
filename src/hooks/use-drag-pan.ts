'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Drag-to-pan for the page-layout paper with the middle mouse button (or a pen
 * side button mapped to middle click). Moves the paper by writing
 * scrollLeft/scrollTop on #scroll-container — the same mechanism zoom and
 * native scrolling use — so annotation coordinates are unaffected.
 *
 * Mounted by AnnotationLayer only, so it is inactive in reflow mode (ReflowGate
 * unmounts the annotation tree there).
 *
 * Limitations: panning only reaches what the scroll container can scroll.
 * Horizontally that means zoom > 1 or a viewport narrower than the scaled
 * paper; at zoom ≤ 1 on a wide screen only vertical movement has an effect.
 * Touch is not handled — single-finger scroll already pans on tablets, and
 * trackpad two-finger scroll is native. Whether a pen's side button arrives as
 * button 1 depends on the tablet driver mapping.
 */
export function useDragPan(scrollContainerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null
    const root = document.documentElement

    const isMiddleInContainer = (e: MouseEvent) =>
      e.button === 1 && !!scrollContainerRef.current?.contains(e.target as Node)

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || !isMiddleInContainer(e)) return
      const container = scrollContainerRef.current!
      // Capture phase + stopPropagation: keeps the canvas from starting a
      // stroke and suppresses middle-click autoscroll.
      e.preventDefault()
      e.stopPropagation()
      drag = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: container.scrollLeft,
        top: container.scrollTop,
      }
      root.style.cursor = 'grabbing'
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return
      const container = scrollContainerRef.current
      if (!container) return
      e.preventDefault()
      e.stopPropagation()
      container.scrollLeft = drag.left - (e.clientX - drag.x)
      container.scrollTop = drag.top - (e.clientY - drag.y)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return
      e.stopPropagation()
      drag = null
      root.style.cursor = ''
    }

    // preventDefault on pointerdown doesn't reliably cancel the mousedown
    // default (middle-click autoscroll) in every browser; cancel here too.
    // auxclick: middle release over a link would otherwise open it in a new tab.
    const cancelMiddle = (e: MouseEvent) => {
      if (isMiddleInContainer(e)) e.preventDefault()
    }

    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('pointermove', onPointerMove, { capture: true })
    window.addEventListener('pointerup', onPointerUp, { capture: true })
    window.addEventListener('pointercancel', onPointerUp, { capture: true })
    window.addEventListener('mousedown', cancelMiddle, { capture: true })
    window.addEventListener('auxclick', cancelMiddle, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointermove', onPointerMove, { capture: true })
      window.removeEventListener('pointerup', onPointerUp, { capture: true })
      window.removeEventListener('pointercancel', onPointerUp, { capture: true })
      window.removeEventListener('mousedown', cancelMiddle, { capture: true })
      window.removeEventListener('auxclick', cancelMiddle, { capture: true })
      root.style.cursor = ''
    }
  }, [scrollContainerRef])
}
