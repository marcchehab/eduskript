'use client'

import { useEffect } from 'react'

// Once-per-tab marker. sessionStorage is per-tab in modern browsers; survives
// the reload itself (so we can detect immediate re-failure) but resets when
// the tab closes.
const RELOAD_KEY = 'eduskript:chunk-reload-at'
const RELOAD_COOLDOWN_MS = 60_000

function isChunkLoadError(reason: unknown): boolean {
  if (!reason) return false
  if (typeof reason === 'object') {
    const err = reason as { name?: string; message?: string }
    if (err.name === 'ChunkLoadError') return true
    if (typeof err.message === 'string' && /Loading chunk \S+ failed/.test(err.message)) return true
  }
  if (typeof reason === 'string' && /Loading chunk \S+ failed/.test(reason)) return true
  return false
}

function tryReload() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable (private mode quota, etc.) — fall through and reload anyway
  }
  window.location.reload()
}

/**
 * Recovers from stale-deploy ChunkLoadErrors by force-reloading the page.
 *
 * After a deploy, a tab that was opened against the previous build still
 * holds the old chunk filenames in its in-memory router. Any client-side
 * navigation triggers a fetch for chunks that no longer exist, React stalls
 * waiting for the chunk, and the page appears frozen for ~30s before failing.
 * Reloading picks up the new HTML and the new chunk references.
 *
 * Cooldown prevents reload loops when a chunk is genuinely missing (dev typo,
 * deploy in progress) — second failure within RELOAD_COOLDOWN_MS is left to
 * surface as the original error.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
        tryReload()
      }
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) tryReload()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
