'use client'

import { useEffect, useState, type ReactNode } from 'react'
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
 * "Present" button — shown to logged-in teachers (or everyone when the page
 * opted in). It is a one-button pill that **flows inline** with the page
 * annotation toolbar: we portal it into the toolbar's sibling slot
 * (`#annotation-toolbar-aside`), so the browser lays the two pills out together
 * and reflows them natively — no `getBoundingClientRect`/interval positioning.
 *
 * The slide overlay (SlidePresenter) is a separate portal to document.body so
 * it escapes the public page's CSS paper transform (which would otherwise be
 * the containing block for its `position: fixed`). React context
 * (Survey/CoupledVideo/StickMe providers this is mounted under) flows through
 * both portals, so slides keep their context.
 */
export function PresentButton({ slides, slideStartLines, publiclyVisible = false }: PresentButtonProps) {
  const { data: session } = useSession()
  const isTeacher = session?.user?.accountType === 'teacher'
  const canPresent = isTeacher || publiclyVisible
  const [startIndex, setStartIndex] = useState<number | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  // Locate the toolbar's sibling slot and portal into it. The toolbar mounts
  // around the same time, so observe the DOM until the slot appears (no polling
  // thereafter — layout is then the browser's job).
  useEffect(() => {
    if (!canPresent) return
    const existing = document.getElementById('annotation-toolbar-aside')
    if (existing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlot(existing)
      return
    }
    const obs = new MutationObserver(() => {
      const el = document.getElementById('annotation-toolbar-aside')
      if (el) {
        setSlot(el)
        obs.disconnect()
      }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [canPresent])

  if (slides.length === 0 || !canPresent) return null

  return (
    <>
      {slot &&
        createPortal(
          // Mirror the annotation toolbar's pill (p-2) wrapping a p-2 button so
          // this one-button toolbar matches its height and width exactly.
          <div className="ml-2 flex items-center rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur print:hidden">
            <button
              onClick={() => setStartIndex(scrolledSlideIndex(slideStartLines))}
              title="Present this page as slides"
              aria-label="Present this page as slides"
              className="p-2 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Presentation className="w-4 h-4" />
            </button>
          </div>,
          slot,
        )}
      {startIndex !== null &&
        createPortal(
          <SlidePresenter
            slides={slides}
            initialIndex={startIndex}
            onExit={() => setStartIndex(null)}
          />,
          document.body,
        )}
    </>
  )
}
