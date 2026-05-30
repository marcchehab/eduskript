'use client'

import { createContext, useContext } from 'react'

/**
 * Broadcasts the active highlighter pen's colour (a CSS colour string) from the
 * annotation toolbar (AnnotationLayer owns pen/mode state) down to the
 * HighlightLayer. `null` means no highlighter pen is active — selecting text
 * does nothing. When non-null, selecting text auto-creates a highlight in that
 * colour. This is the bridge that replaces the old select→colour-panel flow.
 */
export const HighlightPenContext = createContext<{ activeHighlightColor: string | null }>({
  activeHighlightColor: null,
})

export function useHighlightPen(): string | null {
  return useContext(HighlightPenContext).activeHighlightColor
}
