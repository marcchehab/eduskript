/**
 * Wraps a UI control and points at it (pulsing ring + bouncing label) when
 * it's the target for the current next-incomplete onboarding quest step —
 * the same "nudge toward the next action" idea as EmptyPageDragHint
 * (src/components/dashboard/empty-page-drag-hint.tsx), but for a single
 * on-page target instead of a cross-component drag source/drop-zone line.
 * Renders children unchanged (no wrapper, no hooks cost beyond the cheap
 * session check) once that step is done or for non-teacher sessions.
 *
 * The bouncing label is portaled to document.body with fixed positioning:
 * several targets sit inside overflow-hidden containers (new-skript /
 * new-page areas in the page builder), which clipped an absolutely
 * positioned label hanging above the wrapper. Position is re-measured on
 * scroll (capture, to catch inner scroll containers) and resize; no
 * per-frame tracking, so the label can lag briefly during e.g. animated
 * layout shifts.
 */
'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNextIncompleteStep } from '@/lib/onboarding-quest/use-quest-step'
import type { QuestStep } from '@/lib/onboarding-quest/types'

interface QuestSpotlightProps {
  // One control can be the target of several steps (e.g. the public page's
  // profile/edit button is both "go back to your builder" and "return via
  // the edit link") — pass an array to spotlight it for any of them.
  step: QuestStep | QuestStep[]
  label: string
  children: React.ReactNode
}

function SpotlightLabel({
  label,
  targetRef,
}: {
  label: string
  targetRef: React.RefObject<HTMLElement | null>
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const rect = targetRef.current?.getBoundingClientRect()
      // Skip zero-size targets AND targets outside the viewport — the same
      // control can render twice (desktop toolbar + off-canvas mobile
      // toolbar), and the hidden copy would otherwise paint a stray pill
      // off-screen or at the viewport edge.
      if (
        !rect ||
        (rect.width === 0 && rect.height === 0) ||
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        setPos(null)
        return
      }
      setPos({ top: rect.top, left: rect.left + rect.width / 2 })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [targetRef])

  if (!pos) return null

  return createPortal(
    <span
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-blue-500 text-white text-xs font-medium px-2 py-0.5 shadow-lg animate-bounce"
      style={{ top: pos.top - 4, left: pos.left }}
    >
      {label}
    </span>,
    document.body,
  )
}

export function QuestSpotlight({ step, label, children }: QuestSpotlightProps) {
  const next = useNextIncompleteStep()
  const ref = useRef<HTMLSpanElement>(null)

  const steps = Array.isArray(step) ? step : [step]
  if (!next || !steps.includes(next)) return <>{children}</>

  // SpotlightLabel must be a SIBLING rendered after the ref'd span, not a
  // child: a child's useLayoutEffect fires before the parent element's ref
  // is attached, so its first measure would read targetRef.current === null
  // and the label would never appear (nothing re-triggers it without a
  // scroll/resize).
  return (
    <>
      <span ref={ref} className="relative inline-flex">
        {children}
        <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-blue-400 animate-pulse" />
      </span>
      <SpotlightLabel label={label} targetRef={ref} />
    </>
  )
}
