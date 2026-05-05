/**
 * Run a callback once the page has finished loading and the browser has spare
 * main-thread time. Used by code editors to defer heavy runtime preloads
 * (Pyodide, Skulpt, SQL.js + .db blobs) out of the critical-path window so
 * they don't compete on the network and CPU with public annotations, fonts,
 * and other above-the-fold content.
 *
 * Resolution order:
 *   1. Wait for `document.readyState === 'complete'` (or the `load` event).
 *   2. Wait for an idle frame via `requestIdleCallback` with a 5 s timeout
 *      cap so we never starve forever on busy pages.
 *
 * Returns a cancel function. Calling it before the callback fires aborts the
 * scheduling — useful for React effect cleanup when the component unmounts
 * before idle.
 *
 * SSR-safe: silently no-ops when `window` is undefined.
 */
export function deferUntilIdle(
  cb: () => void,
  options: { idleTimeoutMs?: number } = {},
): () => void {
  if (typeof window === 'undefined') return () => {}

  const { idleTimeoutMs = 5000 } = options

  let cancelled = false
  let idleHandle: number | null = null
  let onLoad: (() => void) | null = null

  const scheduleIdle = () => {
    if (cancelled) return
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }).requestIdleCallback
    if (typeof ric === 'function') {
      idleHandle = ric(() => {
        if (!cancelled) cb()
      }, { timeout: idleTimeoutMs })
    } else {
      // Safari fallback: setTimeout 1ms is good enough — the goal is just to
      // yield to the next microtask cycle so we don't block the load handler.
      idleHandle = window.setTimeout(() => {
        if (!cancelled) cb()
      }, 1) as unknown as number
    }
  }

  if (document.readyState === 'complete') {
    scheduleIdle()
  } else {
    onLoad = () => {
      onLoad = null
      scheduleIdle()
    }
    window.addEventListener('load', onLoad, { once: true })
  }

  return () => {
    cancelled = true
    if (onLoad) {
      window.removeEventListener('load', onLoad)
      onLoad = null
    }
    if (idleHandle !== null) {
      const cic = (window as unknown as {
        cancelIdleCallback?: (handle: number) => void
      }).cancelIdleCallback
      if (typeof cic === 'function') cic(idleHandle)
      else window.clearTimeout(idleHandle)
      idleHandle = null
    }
  }
}
