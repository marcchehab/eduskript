'use client'

import {
  createContext,
  useContext,
  useMemo,
  type MutableRefObject,
  type ReactNode,
} from 'react'

/**
 * Single source of truth for the page-zoom factor applied by AnnotationLayer
 * (`transform: scale(z)` on <main>). Consumers needing zoom-corrected drag
 * deltas read it via `useZoom()` and call the returned `getZoom()` from inside
 * event handlers — i.e. lazily, at the moment the value matters.
 *
 * Why a ref-backed getter rather than a state value:
 * - The transform updates per frame during pinch; if we surfaced state, every
 *   gesture frame would re-render every consumer in the tree.
 * - Drag handlers only need the value at mousedown, so lazy-read is fine.
 * - `getZoom` is stable across renders, so consumers can include it in
 *   useCallback deps without invalidating memoized handlers.
 *
 * Default value is 1 (no zoom) so components rendered without a provider
 * (tests, dashboard previews) silently no-op.
 */
interface ZoomContextValue {
  /** Read the live zoom factor. Stable identity across renders. */
  getZoom: () => number
}

const ZoomContext = createContext<ZoomContextValue>({ getZoom: () => 1 })

export function ZoomProvider({
  zoomRef,
  children,
}: {
  zoomRef: MutableRefObject<number>
  children: ReactNode
}) {
  const value = useMemo<ZoomContextValue>(
    () => ({ getZoom: () => zoomRef.current }),
    [zoomRef],
  )
  return <ZoomContext.Provider value={value}>{children}</ZoomContext.Provider>
}

/** Returns a stable `getZoom()` reader for the live ancestor zoom factor. */
export function useZoom(): () => number {
  return useContext(ZoomContext).getZoom
}
