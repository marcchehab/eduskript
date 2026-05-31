'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { HeadingPosition } from '@/lib/annotations/reposition-strokes'

/**
 * Exposes the current heading positions (computed by AnnotationLayer from
 * `[data-section-id]` elements) to descendants. Consumers — sticky notes,
 * snaps, and any future anchor-tracking annotation — use this to translate
 * stored anchors into current pixel offsets without each layer re-querying
 * and re-measuring the DOM.
 *
 * Defaults to an empty array so consumers rendered outside an AnnotationLayer
 * silently no-op rather than crash.
 */
interface HeadingPositionsContextValue {
  positions: HeadingPosition[]
}

const HeadingPositionsContext = createContext<HeadingPositionsContextValue>({ positions: [] })

export function HeadingPositionsProvider({
  positions,
  children,
}: {
  positions: HeadingPosition[]
  children: ReactNode
}) {
  // Memoized so the context value ref only changes when `positions` actually
  // changes — not on every render of the parent (AnnotationLayer re-renders on
  // every pointermove while drawing). Without this, the sole consumer
  // (sticky-notes-layer) re-rendered on every pointer move. Same bug class as
  // the HighlightPenContext fix in annotation-layer.tsx.
  const value = useMemo(() => ({ positions }), [positions])
  return (
    <HeadingPositionsContext.Provider value={value}>
      {children}
    </HeadingPositionsContext.Provider>
  )
}

export function useHeadingPositions(): HeadingPosition[] {
  return useContext(HeadingPositionsContext).positions
}
