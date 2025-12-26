"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

interface StickMeProps {
  children: ReactNode
  /** Offset from top when stuck (default: 16px) */
  topOffset?: number
}

/**
 * StickMe component - pins content to top of viewport when scrolling.
 * Uses CSS position: sticky for buttery smooth, pixel-perfect behavior.
 * Shows paper background color when stuck.
 */
export function StickMe({ children, topOffset = 16 }: StickMeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isStuck, setIsStuck] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Use IntersectionObserver to detect when element becomes stuck
    // By observing a sentinel element at the top
    const observer = new IntersectionObserver(
      ([entry]) => {
        // When the sentinel goes out of view at the top, we're stuck
        setIsStuck(!entry.isIntersecting)
      },
      {
        threshold: 0,
        rootMargin: `-${topOffset + 1}px 0px 0px 0px`,
      }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [topOffset])

  return (
    <>
      {/* Sentinel element to detect when sticky kicks in */}
      <div ref={ref} className="h-0 w-full" aria-hidden="true" />
      <div
        className="sticky z-40"
        style={{ top: topOffset }}
      >
        <div
          className={`rounded-lg transition-shadow duration-200 ${
            isStuck
              ? "bg-card dark:bg-slate-900/95 shadow-lg"
              : ""
          }`}
        >
          {children}
        </div>
      </div>
    </>
  )
}
