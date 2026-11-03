'use client'

/**
 * Layout editing in the print preview: state and saving.
 *
 * Editors (useCanEditPage) can switch "Edit layout" on in the print bar
 * (print-view.tsx). Image/drawing handles (content-image.tsx,
 * excalidraw-image.tsx) and the page-break overlay (print-edit-overlay.tsx)
 * then call applyPrintEdit with a pure transform from print-edits.ts.
 *
 * Saving: the changed line range goes to /api/pages/[id]/replace with `line`,
 * which rejects it (409) if those lines changed meanwhile; then the page is
 * refreshed (router.refresh, registered by PrintEditSource), so the server
 * re-renders it from the saved content. Each save is a PageVersion, like any
 * dashboard save. Undo re-applies the previous content the same way; it only
 * covers edits made in this preview session.
 *
 * The source is the page markdown the server rendered (PrintEditSource in
 * public-page-body.tsx); frontpages register none, so they get no editing.
 * Known limitation: an open page editor in another tab doesn't see these
 * saves until reloaded; its next autosave is rejected as stale (baseVersion).
 */

import { useSyncExternalStore } from 'react'
import { lineRangeEdit } from '@/lib/print/print-edits'

interface PrintEditState {
  pageId: string | null
  content: string | null
  editing: boolean
  /** True from the request until the refreshed page has rendered. */
  saving: boolean
  error: string | null
  /** Contents before each saved edit, newest last. */
  undo: string[]
  /** Bumped when a refreshed page source arrives (print-view.tsx re-paginates). */
  revision: number
}

let state: PrintEditState = { pageId: null, content: null, editing: false, saving: false, error: null, undo: [], revision: 0 }
const SERVER = state
const listeners = new Set<() => void>()
let refresh: (() => void) | null = null
/** Saved content waiting for the refreshed render; the DOM's source lines belong to it only then. */
let pending: string | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
const REFRESH_TIMEOUT_MS = 10_000
const REFRESH_RETRY_MS = 1_000

function set(next: Partial<PrintEditState>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function clearPending() {
  pending = null
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function usePrintEditState(): PrintEditState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER)
}

/** Whether layout handles should show (editing on and a page source known). */
export function usePrintEditing(): boolean {
  const s = usePrintEditState()
  return s.editing && !!s.content
}

/**
 * Registered by PrintEditSource whenever the server content changes. While a
 * save waits for its refresh, only the saved content ends the wait (then the
 * DOM's line numbers match `content` again); anything else is ignored until
 * it arrives (save() keeps refreshing) or REFRESH_TIMEOUT_MS passes.
 */
export function registerPrintEditSource(pageId: string, content: string, onRefresh: () => void) {
  refresh = onRefresh
  if (state.pageId !== pageId) {
    clearPending()
    set({ pageId, content, undo: [], error: null, saving: false, revision: state.revision + 1 })
  } else if (pending !== null) {
    if (content === pending) {
      clearPending()
      set({ content, saving: false, revision: state.revision + 1 })
    }
  } else if (state.content !== content && !state.saving) {
    set({ content, revision: state.revision + 1 })
  }
}

export function unregisterPrintEditSource(pageId: string) {
  if (state.pageId !== pageId) return
  clearPending()
  set({ pageId: null, content: null, editing: false, saving: false, undo: [] })
}

export function setPrintEditing(editing: boolean) {
  set({ editing, error: null })
}

async function save(before: string, after: string): Promise<boolean> {
  const pageId = state.pageId
  if (!pageId) return false
  const edit = lineRangeEdit(before, after)
  set({ saving: true, error: null })
  try {
    const r = await fetch(`/api/pages/${pageId}/replace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edit),
    })
    // Navigated to another page meanwhile: its state is not ours to touch.
    if (state.pageId !== pageId) return false
    if (!r.ok) {
      const data = await r.json().catch(() => null)
      set({ saving: false, error: data?.error || 'Saving failed.' })
      return false
    }
    // The first refresh right after the save can still get the old page
    // from the cache (seen in dev: invalidation lands a moment later), so
    // refresh again every REFRESH_RETRY_MS until the saved content arrives.
    pending = after
    const startedAt = Date.now()
    const retry = () => {
      if (pending !== after) return
      if (Date.now() - startedAt > REFRESH_TIMEOUT_MS) {
        clearPending()
        set({ saving: false, error: 'Saved, but the preview did not update. Reload the page.' })
        return
      }
      refresh?.()
      pendingTimer = setTimeout(retry, REFRESH_RETRY_MS)
    }
    set({ content: after })
    retry()
    return true
  } catch {
    if (state.pageId === pageId) set({ saving: false, error: 'Saving failed (network).' })
    return false
  }
}

/**
 * Apply `transform` to the page source and save it. Resolves false when
 * nothing was saved (busy, element not found, request failed), so a dragged
 * handle can snap back.
 */
export async function applyPrintEdit(transform: (content: string) => string | null): Promise<boolean> {
  const before = state.content
  if (before === null || state.saving) return false
  const after = transform(before)
  if (after === null) {
    set({ error: 'Could not find this element in the page source. Edit it in the page editor.' })
    return false
  }
  if (after === before) return true
  const ok = await save(before, after)
  if (ok) set({ undo: [...state.undo, before] })
  return ok
}

/** Undo the newest edit of this preview session. */
export async function undoPrintEdit(): Promise<void> {
  const target = state.undo[state.undo.length - 1]
  const current = state.content
  if (target === undefined || current === null || state.saving) return
  if (await save(current, target)) set({ undo: state.undo.slice(0, -1) })
}
