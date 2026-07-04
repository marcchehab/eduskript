'use client'

import { type ReactNode, useRef, useEffect, useLayoutEffect, useState } from 'react'

interface ColorTitleHeadingProps {
  id?: string
  children: ReactNode
  className?: string
}

// useLayoutEffect warns during SSR; the shadow only mounts client-side so this is safe.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Color title h1 with animated rainbow shadow effect.
 *
 * Creates a duplicate of the heading content for the rainbow shadow.
 * This approach handles inline <code> elements correctly because both
 * the foreground and shadow have identical HTML structure.
 *
 * The CSS ::before approach (using data-heading-text plain text) doesn't work
 * when the heading contains <code> elements because monospace fonts have
 * different character widths than the heading font.
 *
 * The shadow is an in-flow block (see globals.css) so its text wraps around a
 * floated image identically to the foreground. It keeps its full height so the
 * gradient (background-clip:text) actually paints, and we cancel that height with
 * an equal negative margin-bottom so the foreground copy overlays it at the same
 * top. The height is re-measured on resize/content change via ResizeObserver.
 */
export function ColorTitleHeading({ id, children, className = '' }: ColorTitleHeadingProps) {
  const shadowRef = useRef<HTMLSpanElement>(null)
  const [mounted, setMounted] = useState(false)
  const [shadowHeight, setShadowHeight] = useState(0)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional hydration pattern
    setMounted(true)
  }, [])

  useIsomorphicLayoutEffect(() => {
    const el = shadowRef.current
    if (!el) return
    const measure = () => setShadowHeight(el.offsetHeight)
    measure()
    // Width/content changes reflow the shadow → re-measure so the collapse stays exact.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mounted, children])

  return (
    <h1
      id={id}
      className={`color-title-js relative ${className}`}
    >
      {/* Rainbow shadow - in-flow behind the foreground, height collapsed via
          negative margin so the foreground overlays it (duplicates content structure) */}
      {mounted && (
        <span
          ref={shadowRef}
          aria-hidden="true"
          className="color-title-shadow"
          style={{ marginBottom: -shadowHeight }}
        >
          {children}
        </span>
      )}

      {/* Foreground content with anchor link */}
      {id ? (
        <a href={`#${id}`} className="heading-link no-underline hover:underline relative z-10">
          {children}
        </a>
      ) : (
        <span className="relative z-10">{children}</span>
      )}
    </h1>
  )
}
