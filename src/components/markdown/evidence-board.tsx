'use client'

/**
 * `<evidence-board>`: the evidence a student collected in the Kara levels of
 * this skript (chips and star bonuses, saved by KaraPanel via
 * src/lib/kara/progress.ts). Only collected items are shown — the board has no
 * list of what exists on other pages. Live-updates when a level on the same
 * page saves new evidence.
 */

import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { karaPortrait } from '@/lib/kara/portraits'
import { useUserDataContext } from '@/lib/userdata/provider'
import { loadKaraProgress, subscribeKaraProgress, type KaraProgress } from '@/lib/kara/progress'

export interface EvidenceBoardProps {
  skriptId?: string
  title?: string
  /** Resolved skript files: audio names and `portrait:<speaker>`. */
  assets?: Record<string, string>
}

export function EvidenceBoard({ skriptId, title = 'Evidence board', assets }: EvidenceBoardProps) {
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

  const items = Object.values(progress?.evidence ?? {}).sort((a, b) => a.level.localeCompare(b.level) || a.id.localeCompare(b.id))
  const levels = Object.keys(progress?.levels ?? {}).length

  return (
    <div className="not-prose my-6 rounded-lg border bg-muted/20 p-4" data-interactive="true">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{items.length} evidence · {levels} levels solved</span>
      </div>
      {!skriptId && <p className="text-sm text-muted-foreground">Only available inside a skript.</p>}
      {skriptId && items.length === 0 && <p className="text-sm text-muted-foreground">Nothing found yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map(e => {
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
                <p className="mt-1 text-sm whitespace-pre-wrap">{e.text}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
