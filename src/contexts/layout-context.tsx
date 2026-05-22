'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { LAYOUT } from '@/lib/constants/layout'

interface LayoutContextValue {
  sidebarWidth: number
  sidebarCollapsed: boolean
  viewportWidth: number
  viewportHeight: number
  setSidebarCollapsed: (collapsed: boolean) => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [viewportWidth, setViewportWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Calculate sidebar width based on viewport and collapse state
  const sidebarWidth = (() => {
    // On mobile (< lg breakpoint), sidebar overlays so it doesn't affect layout
    if (viewportWidth < LAYOUT.BREAKPOINT_LG) {
      return 0
    }
    // On desktop, use defined widths based on collapse state
    return sidebarCollapsed ? LAYOUT.SIDEBAR_WIDTH_COLLAPSED : LAYOUT.SIDEBAR_WIDTH_EXPANDED
  })()

  const measureViewport = useCallback(() => {
    setViewportWidth(window.innerWidth)
    setViewportHeight(window.innerHeight)
  }, [])

  // Initial measurement
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measureViewport()
  }, [measureViewport])

  // Measure on window resize
  useEffect(() => {
    let rafId: number | null = null
    let isScheduled = false

    const handleResize = () => {
      if (!isScheduled) {
        isScheduled = true
        rafId = requestAnimationFrame(() => {
          measureViewport()
          isScheduled = false
        })
      }
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [measureViewport])

  return (
    <LayoutContext.Provider value={{
      sidebarWidth,
      sidebarCollapsed,
      viewportWidth,
      viewportHeight,
      setSidebarCollapsed
    }}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider')
  }
  return context
}
