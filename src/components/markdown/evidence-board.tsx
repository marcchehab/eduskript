'use client'

/**
 * `<evidence-board>`: the clues of the Kara levels on this page and which of
 * them the student has found. The clues themselves (title, text, speaker)
 * come from the levels' definitions on the page (pageKaraClues in
 * src/lib/kara/world.ts); the saved progress (src/lib/kara/progress.ts) only
 * decides found / not found by id. So the board can never show a clue that no
 * level defines, nor an outdated copy of one. Clues not found yet show as
 * placeholders naming the section of their level. Live-updates when a level
 * on the same page saves.
 *
 * `levels="w1-,w2-"` (optional): only clues whose level id starts with one of
 * these prefixes; the «levels solved» count is filtered the same way.
 * Limitation: only levels on the same page are known to the board.
 */

import { displayText } from '@/lib/kara/voice-directions'
import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { karaPortrait } from '@/lib/kara/portraits'
import { useUserDataContext } from '@/lib/userdata/provider'
import { loadKaraProgress, subscribeKaraProgress, type KaraProgress } from '@/lib/kara/progress'
import type { KaraPageClue } from '@/lib/kara/world'

export interface EvidenceBoardProps {
  skriptId?: string
  title?: string
  /** Resolved skript files: audio names and `portrait:<speaker>`. */
  assets?: Record<string, string>
  /** Comma-separated level-id prefixes; empty = every level of the page. */
  levels?: string
  /** Clue definitions of the page's levels, in page order (pageKaraClues). */
  clues: KaraPageClue[]
}

export function EvidenceBoard({ skriptId, title = 'Evidence board', assets, levels: levelFilter, clues }: EvidenceBoardProps) {
  const [progress, setProgress] = useState<KaraProgress | null>(null)
  // Read only once the user-data DB is ready: before that, the logged-in user
  // isn't set yet and the read would hit the (empty) anonymous store.
  const { isDbReady } = useUserDataContext()

  useEffect(() => {
    if (!skriptId || !isDbReady) return
    let alive = true
    void loadKaraProgress(skriptId).then(p => { if (alive) setProgress(p) })
    const unsubscribe = subscribeKaraProgress(skriptId, setProgress)
    return () => { alive = false; unsubscribe() }
  }, [skriptId, isDbReady])

  const prefixes = (levelFilter ?? '').split(',').map(p => p.trim()).filter(Boolean)
  const shown = (level: string) => !prefixes.length || prefixes.some(p => level.startsWith(p))
  const items = clues.filter(c => shown(c.level))
  const isFound = (c: KaraPageClue) => !!progress?.evidence[c.id]
  const foundCount = items.filter(isFound).length
  const levels = Object.keys(progress?.levels ?? {}).filter(shown).length

  return (
    <div className="not-prose my-6 rounded-lg border bg-muted/20 p-4" data-interactive="true">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{foundCount} of {items.length} {items.length === 1 ? 'clue' : 'clues'} found · {levels} {levels === 1 ? 'level' : 'levels'} solved</span>
      </div>
      {!skriptId && <p className="text-sm text-muted-foreground">Only available inside a skript.</p>}
      {skriptId && items.length === 0 && <p className="text-sm text-muted-foreground">No level on this page has clues.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map(e => {
          if (!isFound(e)) return (
            <div key={e.id} className="flex items-center gap-3 rounded-md border border-dashed bg-background/40 p-3 text-muted-foreground">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted text-2xl font-bold">?</div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">Not found yet</div>
                {e.section && <div className="text-xs">in {e.section}</div>}
              </div>
            </div>
          )
          const speaker = e.speaker?.toLowerCase()
          const portrait = speaker ? karaPortrait(speaker, assets) : undefined
          const audio = e.audio ? assets?.[e.audio] : undefined
          return (
            <div key={e.id} className="flex gap-3 rounded-md border bg-background p-3 shadow-sm">
              {portrait && (
                // eslint-disable-next-line @next/next/no-img-element -- skript file URL, sized by CSS
                <img src={portrait} alt={e.speaker} className="h-14 w-14 shrink-0 rounded object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{e.title}</span>
                  {audio && (
                    <button onClick={() => void new Audio(audio).play()} className="text-muted-foreground hover:text-foreground" title="Play">
                      <Volume2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {e.speaker && <div className="text-xs text-muted-foreground">{e.speaker}</div>}
                <p className="mt-1 text-sm whitespace-pre-wrap">{displayText(e.text)}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
