'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const REF_SELECTOR = 'sup a[href^="#user-content-fn-"]'
const HIDE_DELAY_MS = 200

interface Preview {
  html: string
  top: number
  left: number
  above: boolean
}

/**
 * Hover/focus preview for GFM footnote refs. Uses event delegation on the
 * document, so it covers every rendered markdown body on the page (and slides)
 * without touching the compile pipeline. The box copies the innerHTML of the
 * matching `<li id="user-content-fn-…">` (already sanitized — it is rendered
 * page DOM) minus the backref arrow.
 *
 * Portals to document.body with `position: fixed` from getBoundingClientRect,
 * which already includes the `#paper` zoom transform. Stays open while the
 * pointer is over the box so its links are clickable. Touch devices never fire
 * hover, so a tap still jumps to the footnote as before.
 */
export function FootnotePreview() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }, [])
  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimer.current = setTimeout(() => setPreview(null), HIDE_DELAY_MS)
  }, [cancelHide])

  useEffect(() => {
    const show = (e: Event) => {
      const ref = (e.target as Element | null)?.closest?.(REF_SELECTOR) as HTMLAnchorElement | null
      if (!ref) return
      const id = decodeURIComponent(ref.getAttribute('href')!.slice(1))
      const note = document.getElementById(id)
      if (!note) return
      const clone = note.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.data-footnote-backref').forEach((el) => el.remove())
      const rect = ref.getBoundingClientRect()
      const above = rect.top > window.innerHeight / 2
      cancelHide()
      setPreview({
        html: clone.innerHTML,
        top: above ? rect.top - 8 : rect.bottom + 8,
        left: rect.left + rect.width / 2,
        above,
      })
    }
    const hide = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(REF_SELECTOR)) scheduleHide()
    }
    const close = () => setPreview(null)

    document.addEventListener('mouseover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('mouseout', hide)
    document.addEventListener('focusout', hide)
    // Public pages scroll inside #scroll-container, not window — capture both.
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mouseover', show)
      document.removeEventListener('focusin', show)
      document.removeEventListener('mouseout', hide)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('scroll', close, true)
      cancelHide()
    }
  }, [cancelHide, scheduleHide])

  // Centered on the marker, then nudged back inside the viewport once the
  // box's real width is known.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || !preview) return
    const margin = 16
    const width = box.offsetWidth
    const left = Math.min(Math.max(preview.left - width / 2, margin), window.innerWidth - width - margin)
    box.style.left = `${left}px`
  }, [preview])

  if (!preview) return null

  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
      className="footnote-preview prose-theme fixed z-9999 w-max rounded-md border border-border bg-popover text-popover-foreground shadow-lg px-3 py-2"
      style={{
        top: preview.top,
        left: preview.left,
        // Inline, not Tailwind classes: `.prose-theme` (needed for link
        // styling) sets its own font-size and would win over text-sm.
        maxWidth: 'min(28rem, calc(100vw - 2rem))',
        fontSize: '0.875rem',
        lineHeight: 1.45,
        transform: preview.above ? 'translateY(-100%)' : undefined,
      }}
      dangerouslySetInnerHTML={{ __html: preview.html }}
    />,
    document.body,
  )
}
