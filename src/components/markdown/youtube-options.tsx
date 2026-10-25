'use client'

import { useState } from 'react'
import { Clock, LocateFixed } from 'lucide-react'

/** 83 → "1:23", 3723 → "1:02:03". */
export function formatStartTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "1:23" / "1:02:03" / "83" → seconds; "" → null (no start time); invalid → undefined. */
export function parseStartTime(input: string): number | null | undefined {
  const t = input.trim()
  if (!t) return null
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return undefined
  return t.split(':').reduce((acc, part) => acc * 60 + parseInt(part, 10), 0)
}

interface YoutubeOptionsProps {
  startTime?: number
  /** True once the iframe is loaded; enables "use current position". */
  playerOpen: boolean
  /** Last playback position reported by the player (seconds), or null if none yet. */
  getCurrentTime: () => number | null
  /** null removes the startTime attribute. */
  onChange: (startTime: number | null) => void
}

/**
 * Editor-only start-time gizmo over a YouTube embed. Type m:ss (or seconds) and
 * press Enter / blur, or take the player's current position. Rendered only when
 * the renderer passes onYoutubeChange, i.e. in the dashboard preview — same
 * pattern as MuxVideoOptions.
 */
export function YoutubeOptions({ startTime, playerOpen, getCurrentTime, onChange }: YoutubeOptionsProps) {
  const shown = startTime ? formatStartTime(startTime) : ''
  const [draft, setDraft] = useState(shown)
  // Re-sync the field when the source changes from elsewhere (reset during render, no effect).
  const [syncedFor, setSyncedFor] = useState(shown)
  if (syncedFor !== shown) {
    setSyncedFor(shown)
    setDraft(shown)
  }
  const invalid = parseStartTime(draft) === undefined

  const commit = () => {
    const parsed = parseStartTime(draft)
    if (parsed === undefined) { setDraft(shown); return }
    if ((parsed || null) !== (startTime || null)) onChange(parsed || null)
  }

  const useCurrent = () => {
    const t = getCurrentTime()
    if (t === null) return
    const sec = Math.floor(t)
    setDraft(sec ? formatStartTime(sec) : '')
    onChange(sec || null)
  }

  return (
    <span
      // Clicks must not reach the thumbnail underneath (it would start the video).
      onClick={(e) => e.stopPropagation()}
      className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded border border-border/50 bg-background/95 p-0.5 opacity-60 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
      <Clock className="mx-1 h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        placeholder="0:00"
        title="Start time (m:ss or seconds) — Enter to apply, empty = from the beginning"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') setDraft(shown)
        }}
        className={`h-6 w-16 rounded bg-transparent px-1 font-mono text-xs outline-none focus:bg-accent ${invalid ? 'text-destructive' : ''}`}
      />
      <button
        type="button"
        onClick={useCurrent}
        disabled={!playerOpen}
        title={playerOpen ? 'Start at the current playback position' : 'Play the video to pick the current position'}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <LocateFixed className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
