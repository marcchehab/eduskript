'use client'

/**
 * Layout editing in the print preview: state and saving.
 *
 * Editors (useCanEditPage) edit the layout whenever the print preview is
 * open (print-view.tsx sets `editing`; there is no mode switch). Image/drawing handles (content-image.tsx,
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
 * Optimistic preview: applyPrintEdit's `preview` changes the DOM at once
 * (e.g. a placeholder .print-pagebreak, print-edit-overlay.tsx) and
 * re-paginates, so the edit shows without waiting for save + refresh
 * (~0.5–1s). The placeholders (.print-optimistic, .print-optimistic-hidden)
 * are undone when the refreshed page arrives (in the same layout effect that
 * registers it, so no frame shows both) or when saving fails.
 *
 * Undo is optimistic too: each edit may pass `revert`, which shows the
 * previous state at once (a page break hidden or re-inserted, an image width
 * or spacer height via usePrintOverride) while the old content saves. Edits
 * without `revert` undo after the refresh, as before.
 *
 * Known limitation: an open page editor in another tab doesn't see these
 * saves until reloaded; its next autosave is rejected as stale (baseVersion).
 */

import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { lineRangeEdit } from '@/lib/print/print-edits'

interface UndoEntry { content: string; revert?: () => void }

interface PrintEditState {
  pageId: string | null
  content: string | null
  editing: boolean
  /** True from the request until the refreshed page has rendered. */
  saving: boolean
  error: string | null
  /** Contents before each saved edit (with their optimistic revert), newest last. */
  undo: UndoEntry[]
  /** Bumped when a refreshed page source arrives (print-view.tsx re-paginates). */
  revision: number
}

let state: PrintEditState = { pageId: null, content: null, editing: false, saving: false, error: null, undo: [], revision: 0 }
const SERVER = state
const listeners = new Set<() => void>()
let refresh: (() => void) | null = null
/** The paginator's run (print-view.tsx); null while the print view is off. */
let repaginate: (() => void) | null = null

export function setPrintRepaginate(fn: (() => void) | null) {
  repaginate = fn
}

/**
 * Print-only attribute values shown before the saved page renders, keyed by
 * kind + source line ("width:12", "height:30"); null = attribute removed.
 * Cleared with the other placeholders.
 */
const overrides = new Map<string, string | null>()

/**
 * Rendered synchronously (flushSync), so the re-pagination right after it
 * measures the new size. Call from event handlers only, not during render.
 */
export function setPrintOverride(key: string, value: string | null) {
  overrides.set(key, value)
  flushSync(() => { for (const l of listeners) l() })
}

/** `value` unless an override for `key` is pending. */
export function usePrintOverride(key: string, value: string | undefined): string | undefined {
  const o = useSyncExternalStore(subscribe, () => overrides.get(key), () => undefined)
  return o === undefined ? value : (o ?? undefined)
}

/**
 * Re-paginate now and once more next frame: a preview's DOM change is there
 * at once, but a size handed through React state (ResizableWrapper syncs
 * its width in an effect) only lands a render later.
 */
function repaginateSoon() {
  repaginate?.()
  requestAnimationFrame(() => repaginate?.())
}

function dropOptimistic() {
  if (overrides.size) {
    overrides.clear()
    for (const l of listeners) l()
  }
  if (typeof document === 'undefined') return
  document.querySelectorAll('.print-optimistic').forEach((el) => el.remove())
  document.querySelectorAll('.print-optimistic-hidden').forEach((el) => el.classList.remove('print-optimistic-hidden'))
}
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
      dropOptimistic()
      repaginate?.()
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
        dropOptimistic()
        repaginate?.()
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
 * handle can snap back. `preview` (optional) shows the edit in the DOM right
 * away; see "Optimistic preview" above.
 */
export async function applyPrintEdit(
  transform: (content: string) => string | null,
  { preview, revert }: { preview?: () => void; revert?: () => void } = {},
): Promise<boolean> {
  const before = state.content
  if (before === null || state.saving) return false
  const after = transform(before)
  if (after === null) {
    set({ error: 'Could not find this element in the page source. Edit it in the page editor.' })
    return false
  }
  if (after === before) return true
  if (preview) { preview(); repaginateSoon() }
  const ok = await save(before, after)
  if (ok) set({ undo: [...state.undo, { content: before, revert }] })
  else if (preview) { dropOptimistic(); repaginateSoon() }
  return ok
}

/** Undo the newest edit of this preview session. */
export async function undoPrintEdit(): Promise<void> {
  const target = state.undo[state.undo.length - 1]
  const current = state.content
  if (target === undefined || current === null || state.saving) return
  if (target.revert) { target.revert(); repaginateSoon() }
  if (await save(current, target.content)) set({ undo: state.undo.slice(0, -1) })
  else if (target.revert) { dropOptimistic(); repaginateSoon() }
}
