'use client'

import { useEffect, useState } from 'react'
import type { TikzResult } from '@/lib/tikz/render.server'
import { TikzImageView, TikzPlaceholder } from './tikz-image'

// Rendered blocks of this browser session: scrolling the editor preview or
// re-compiling the page must not run TeX again for an unchanged block.
const rendered = new Map<string, TikzResult>()
const pending = new Map<string, Promise<TikzResult>>()

function request(key: string, source: string, skriptId: string | undefined): Promise<TikzResult> {
  let promise = pending.get(key)
  if (!promise) {
    promise = fetch('/api/tikz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, skriptId }),
    })
      .then(async (response): Promise<TikzResult> => {
        const data = (await response.json().catch(() => null)) as TikzResult | null
        if (data && ('image' in data || 'error' in data)) return data
        return { error: `TikZ rendering failed (HTTP ${response.status}).` }
      })
      .catch((): TikzResult => ({ error: 'TikZ rendering failed: no connection to the server.' }))
      .then((result) => {
        pending.delete(key)
        // A failed request may work next time; a TeX error is a real result.
        if ('image' in result || !/HTTP|no connection|Too many|Sign in/.test(result.error)) {
          if (rendered.size > 300) rendered.clear()
          rendered.set(key, result)
        }
        return result
      })
    pending.set(key, promise)
  }
  return promise
}

/**
 * Browser path of a ```tikz block (editor preview, teacher-only content): TeX
 * cannot run here, so the block is sent to /api/tikz. While typing, the previous
 * picture stays until the new one arrives.
 *
 * `preambleUrl` is the URL of the skript's tikz-preamble.tex; it only serves as
 * part of the cache key, so a re-uploaded preamble re-renders the blocks.
 */
export function TikzFigureClient({ source, skriptId, preambleUrl }: { source: string; skriptId?: string; preambleUrl?: string }) {
  const key = `${skriptId ?? ''}\u0000${preambleUrl ?? ''}\u0000${source}`
  // The last picture fetched by this instance; a block already rendered in
  // this session (cache hit) is read during render and needs no state.
  const [fetched, setFetched] = useState<{ key: string; result: TikzResult } | null>(null)
  const known = rendered.get(key)
  const state = known ? { key, result: known } : fetched

  useEffect(() => {
    if (rendered.has(key)) return
    let cancelled = false
    // Typing in a block changes the source on every keystroke: wait for a pause.
    const timer = setTimeout(() => {
      void request(key, source, skriptId).then((result) => {
        if (!cancelled) setFetched({ key, result })
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, source, skriptId])

  if (!state) return <TikzPlaceholder>Rendering TikZ…</TikzPlaceholder>
  return (
    <span className={state.key === key ? 'block' : 'block opacity-60'}>
      <TikzImageView result={state.result} />
    </span>
  )
}
