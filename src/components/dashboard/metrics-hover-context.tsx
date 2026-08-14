'use client'

/**
 * Shared hover-time state for the metrics admin panel.
 *
 * Hovering any chart (the per-metric line charts, the calculated-metric
 * chart, or the DB-awake-time bar chart) sets one shared timestamp; every
 * chart independently looks up its own nearest matching bucket and draws its
 * own crosshair, so a spike can be lined up across charts even though they
 * come from different queries/processes and don't share an array.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface MetricsHoverValue {
  hoveredTime: number | null
  setHoveredTime: (t: number | null) => void
}

const MetricsHoverContext = createContext<MetricsHoverValue | null>(null)

export function MetricsHoverProvider({ children }: { children: ReactNode }) {
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)
  const value = useMemo(() => ({ hoveredTime, setHoveredTime }), [hoveredTime])
  return <MetricsHoverContext.Provider value={value}>{children}</MetricsHoverContext.Provider>
}

export function useMetricsHover(): MetricsHoverValue {
  const ctx = useContext(MetricsHoverContext)
  if (!ctx) throw new Error('useMetricsHover must be used within MetricsHoverProvider')
  return ctx
}

/**
 * Index of the timestamp in `timestamps` nearest to `targetMs`, or null if
 * the array is empty.
 *
 * No tolerance cutoff: a metric only gets an hourly row when it actually
 * recorded something (db_queries_total has no row for an hour with zero
 * queries), so the hour a user is hovering in one chart routinely has no
 * exact match in another. Snapping to the closest point that DOES exist is
 * what makes the crosshair mirror across every chart, including the quiet
 * hours — a tolerance cutoff here just meant the DB-awake-time chart's empty
 * bars refused to draw an indicator anywhere else on the page.
 */
export function findNearestBucket(timestamps: string[], targetMs: number): number | null {
  let bestIndex: number | null = null
  let bestDelta = Infinity
  for (let i = 0; i < timestamps.length; i++) {
    const delta = Math.abs(new Date(timestamps[i]).getTime() - targetMs)
    if (delta < bestDelta) {
      bestDelta = delta
      bestIndex = i
    }
  }
  return bestIndex
}

/** Compact label for a crosshair: "Aug 12, 21:00". */
export function formatHoverTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
