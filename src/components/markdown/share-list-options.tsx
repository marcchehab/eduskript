'use client'

import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { CLASS_LIST, isValidListName } from '@/lib/plugin-share'

/** "Kapitel 3" → "kapitel-3"; the result may still be invalid, e.g. when empty. */
export function toListName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

const OFF = 'off'
const CUSTOM = 'custom'

interface ShareListOptionsProps {
  /** Current attribute value; undefined when the tag has none. */
  value?: string
  /** Plugins may share nothing; a leaderboard always has a list. */
  allowOff?: boolean
  /** null removes the attribute. */
  onChange: (value: string | null) => void
}

/**
 * Editor-only gizmo choosing a list: the class or a custom name. Rendered only
 * when the renderer passes onTagAttributeChange, i.e. in the dashboard preview.
 * Without allowOff, "class" removes the attribute, since it is the default.
 */
export function ShareListOptions({ value, allowOff = false, onChange }: ShareListOptionsProps) {
  const isCustom = !!value && value !== CLASS_LIST
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState(isCustom ? value : '')
  const [syncedFor, setSyncedFor] = useState(value)
  if (syncedFor !== value) {
    setSyncedFor(value)
    setDraft(isCustom ? value : '')
    setPicking(false)
  }

  const selected = isCustom || picking ? CUSTOM : !value && allowOff ? OFF : CLASS_LIST

  const pick = (next: string) => {
    if (next === CUSTOM) { setPicking(true); return }
    setPicking(false)
    onChange(next === OFF || !allowOff ? null : CLASS_LIST)
  }

  const commit = () => {
    const name = toListName(draft)
    if (isValidListName(name) && name !== value) onChange(name)
  }

  return (
    <div className="my-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Trophy className="h-3.5 w-3.5" />
      <select
        aria-label="Leaderboard list"
        value={selected}
        onChange={(e) => pick(e.target.value)}
        className="rounded border border-border bg-background px-1 py-0.5"
      >
        {allowOff && <option value={OFF}>No list</option>}
        <option value={CLASS_LIST}>Class</option>
        <option value={CUSTOM}>Custom name</option>
      </select>
      {selected === CUSTOM && (
        <input
          aria-label="List name"
          value={draft}
          placeholder="chapter-3"
          title="Same name on several pages adds up across them, for all classes of this site. Enter to apply."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          className="w-32 rounded border border-border bg-background px-1 py-0.5"
        />
      )}
      {selected === OFF && <span>Points still count on a leaderboard on this page.</span>}
    </div>
  )
}
