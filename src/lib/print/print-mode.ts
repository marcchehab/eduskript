'use client'

/**
 * Print view state. The print view is the normal public page in an A4 layout
 * (html.print-layout): fixed 1280px paper zoomed onto A4 in print, gaps that
 * push blocks onto the next page, paper fallbacks for interactive components
 * and solutions moved to the end. Entered with the Print button or `?print`.
 * While active it overrides reading mode (use-reflow-mode.ts) and the dark
 * theme (providers.tsx) without touching the stored preferences.
 *
 * Module-level store (useSyncExternalStore), since the button, the page body
 * and markdown components live in separate React trees.
 *
 * @see src/components/print/print-view.tsx (bar + pagination)
 * @see src/lib/print/solutions.ts (solution appendix)
 */

import { useSyncExternalStore } from 'react'

/**
 * Which solutions the print view appends. 'online': exactly those a viewer
 * sees online (the spec default, and the only mode students get). 'all': also
 * the hidden ones (exam pages, quizzes without feedback). 'none': a student
 * copy without any.
 */
export type SolutionMode = 'online' | 'all' | 'none'

interface PrintState {
  active: boolean
  solutions: SolutionMode
}

let state: PrintState = { active: false, solutions: 'online' }
const listeners = new Set<() => void>()
const SERVER: PrintState = { active: false, solutions: 'online' }

function emit() {
  for (const l of listeners) l()
}

export function setPrintState(next: Partial<PrintState>) {
  state = { ...state, ...next }
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('print-layout', state.active)
  emit()
}

// Separate store, so a pagination pass re-renders only the stroke layers.
let layoutVersion = 0
const layoutListeners = new Set<() => void>()

/** Called by the paginator after every pass; stroke layers re-measure on it. */
export function bumpPrintLayout() {
  layoutVersion++
  for (const l of layoutListeners) l()
}

function subscribeLayout(l: () => void) {
  layoutListeners.add(l)
  return () => { layoutListeners.delete(l) }
}

export function usePrintLayoutVersion(): number {
  return useSyncExternalStore(subscribeLayout, () => layoutVersion, () => 0)
}

export function subscribePrint(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function isPrintActive(): boolean {
  return state.active
}

export function usePrintState(): PrintState {
  return useSyncExternalStore(subscribePrint, () => state, () => SERVER)
}

export function usePrintMode(): boolean {
  return usePrintState().active
}

/** Whether the URL asks for the print view (`?print`). */
export function urlWantsPrint(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('print')
}

/** Enter print view from `?print` once on the client. */
export function initPrintFromUrl() {
  if (state.active) return
  if (urlWantsPrint()) setPrintState({ active: true })
}
