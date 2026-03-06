'use client'

/**
 * StickyNotesContext
 *
 * Shared state for sticky-note placement mode, accessible to both:
 * - AnnotationLayer (needs it to show toolbar button + activate via toolbar)
 * - StickyNotesLayer (needs it to know when to accept placement clicks)
 *
 * Provided above both components in AnnotationWrapper.
 */

import { createContext, useContext, useState, type ReactNode } from 'react'

interface StickyNotesContextValue {
  /** Whether the user is in "click to place a note" mode */
  placementMode: boolean
  setPlacementMode: (v: boolean | ((prev: boolean) => boolean)) => void
  /** Live count of notes on this page (reported by StickyNotesLayer) */
  noteCount: number
  setNoteCount: (v: number) => void
}

const StickyNotesContext = createContext<StickyNotesContextValue>({
  placementMode: false,
  setPlacementMode: () => {},
  noteCount: 0,
  setNoteCount: () => {},
})

export function StickyNotesProvider({ children }: { children: ReactNode }) {
  const [placementMode, setPlacementMode] = useState(false)
  const [noteCount, setNoteCount] = useState(0)

  return (
    <StickyNotesContext.Provider value={{ placementMode, setPlacementMode, noteCount, setNoteCount }}>
      {children}
    </StickyNotesContext.Provider>
  )
}

export const useStickyNotesContext = () => useContext(StickyNotesContext)
