'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from 'next-auth/react'
import { Presentation } from 'lucide-react'
import { SlidePresenter } from './slide-presenter'

interface PresentButtonProps {
  /** Pre-compiled slide nodes from the server renderer (split by splitSlides). */
  slides: ReactNode[]
  /** 1-based source line each slide starts at (splitSlides), for "start where
   *  you're scrolled to" — maps the topmost in-view element to a slide. */
  slideStartLines: number[]
  /** When true the button is shown to everyone; otherwise teachers only. */
  publiclyVisible?: boolean
}

/**
 * Find the slide matching the current scroll position. Reads `data-source-line-
 * start` (added by rehypeSourceLine) off the topmost element still in view,
 * then picks the last slide whose start line is at or above it. Falls back to 0.
 */
function scrolledSlideIndex(slideStartLines: number[]): number {
  if (slideStartLines.length <= 1) return 0
  const els = Array.from(
    document.querySelectorAll<HTMLElement>('#paper [data-source-line-start]'),
  )
  const threshold = 120 // a little below the top, so the heading you just passed counts
  let line = 0
  for (const el of els) {
    if (el.getBoundingClientRect().top <= threshold) {
      const v = Number(el.getAttribute('data-source-line-start'))
      if (v) line = v
    } else {
      break // elements are in document (top-to-bottom) order
    }
  }
  let idx = 0
  for (let i = 0; i < slideStartLines.length; i++) {
    if (slideStartLines[i] <= line) idx = i
    else break
  }
  return idx
}

/**
 * "Present" button — shown only to logged-in teachers. Docks just to the left
 * of the page annotation toolbar (a sibling teacher control) by measuring
 * `#annotation-toolbar`; falls back to bottom-right when that toolbar is absent.
 *
 * Rendered through a portal to document.body: the public page scales the paper
 * with a CSS transform, which would otherwise become the containing block for
 * our `position: fixed` overlay (confining it to the paper box). The portal
 * escapes that transform; React context (Survey/CoupledVideo/StickMe providers
 * this is mounted under) still flows through, so slides keep their context.
 */
export function PresentButton({ slides, slideStartLines, publiclyVisible = false }: PresentButtonProps) {
  const { data: session } = useSession()
  const isTeacher = session?.user?.accountType === 'teacher'
  const canPresent = isTeacher || publiclyVisible
  const [startIndex, setStartIndex] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({ right: 24, bottom: 24 })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // Dock next to the annotation toolbar. Re-measured on resize and on a slow
  // interval (catches the toolbar mounting late / sidebar toggles).
  useEffect(() => {
    if (!canPresent) return
    const place = () => {
      const tb = document.getElementById('annotation-toolbar')
      if (tb) {
        const r = tb.getBoundingClientRect()
        // Dock just to the RIGHT of the annotation toolbar.
        setPos({ left: r.right + 8, bottom: window.innerHeight - r.bottom })
      } else {
        setPos({ right: 24, bottom: 24 })
      }
    }
    place()
    window.addEventListener('resize', place)
    const id = setInterval(place, 1000)
    return () => {
      window.removeEventListener('resize', place)
      clearInterval(id)
    }
  }, [canPresent])

  if (slides.length === 0 || !mounted || !canPresent) return null

  return createPortal(
    <>
      {/* A standalone one-button toolbar, styled like the annotation toolbar. */}
      <div
        style={pos}
        className="fixed z-50 rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur print:hidden"
      >
        <button
          onClick={() => setStartIndex(scrolledSlideIndex(slideStartLines))}
          title="Present this page as slides"
          aria-label="Present this page as slides"
          className="p-2 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Presentation className="w-4 h-4" />
        </button>
      </div>
      {startIndex !== null && (
        <SlidePresenter
          slides={slides}
          initialIndex={startIndex}
          onExit={() => setStartIndex(null)}
        />
      )}
    </>,
    document.body,
  )
}
