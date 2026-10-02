'use client'

/**
 * Level briefing above a Kara editor (`intro:` lines of the kara-world block,
 * see src/lib/kara/world.ts). Several lines render as a short stacked
 * dialogue with portraits (karaPortrait). The play button speaks the lines in
 * order (skript `audio=` file, else the cached TTS line; speakers without a
 * voice are skipped). Nothing plays on page load: the editor calls
 * `autoplayRef` on the student's first pointer-down inside it, which plays the
 * dialogue once unless the level is already solved or the page is muted.
 *
 * Solved levels (saved stars > 0, src/lib/kara/progress.ts) start collapsed
 * to one line. Only the first progress read decides this: a win during the
 * session does not collapse the card, because that would shift the editor
 * up while the student watches the replay.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Square, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { karaPortrait } from '@/lib/kara/portraits'
import { loadKaraProgress } from '@/lib/kara/progress'
import { onVoiceStop, playVoice, stopVoice, ttsLineUrl } from '@/lib/kara/voice'
import { isMuted, registerSoundSource, useMuted } from '@/lib/sound'
import type { KaraMessage } from '@/lib/kara/world'

interface KaraIntroProps {
  lines: KaraMessage[]
  assets?: Record<string, string>
  levelId: string
  skriptId?: string
  /** Set by KaraIntro; the editor calls it once, on the first pointer-down inside it. */
  autoplayRef: React.RefObject<(() => void) | null>
}

export function KaraIntro({ lines, assets, levelId, skriptId, autoplayRef }: KaraIntroProps) {
  const [solved, setSolved] = useState(false)
  const [open, setOpen] = useState(true)
  /** Index of the line being spoken, null when silent. */
  const [speaking, setSpeaking] = useState<number | null>(null)
  const muted = useMuted()
  /** Bumped on every start/stop; a running sequence stops when it no longer matches. */
  const run = useRef(0)
  /** True while one of our lines is loading or playing. */
  const active = useRef(false)

  useEffect(() => {
    if (!skriptId) return
    let cancelled = false
    void loadKaraProgress(skriptId).then(p => {
      if (cancelled || !(p.levels[levelId] > 0)) return
      setSolved(true)
      setOpen(false)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [skriptId, levelId])

  useEffect(() => registerSoundSource(), [])

  /** Speak the lines in order; resolves when done or cut off (stop, another voice, mute). */
  const play = useCallback(async () => {
    const token = ++run.current
    active.current = true
    for (let i = 0; i < lines.length && token === run.current; i++) {
      const { audio, speaker, text } = lines[i]
      setSpeaking(i)
      const url = (audio && assets?.[audio]) || (speaker ? await ttsLineUrl(speaker, text) : null)
      if (token !== run.current || isMuted()) break
      if (!url) continue // speaker without a voice
      const finished = await new Promise<boolean>(resolve => {
        // playVoice() stops the previous line synchronously, so subscribing
        // afterwards only catches interruptions of this line.
        const started = playVoice(url, speaker, () => { off(); resolve(true) })
        const off = onVoiceStop(() => { off(); resolve(false) })
        started.catch(() => { off(); resolve(false) })
      })
      if (!finished) break
    }
    if (token === run.current) { run.current++; active.current = false; setSpeaking(null) }
  }, [lines, assets])

  // Stop our line when the editor unmounts (only while one is ours).
  useEffect(() => () => { if (active.current) { run.current++; stopVoice() } }, [])

  const toggle = () => {
    if (speaking !== null) { run.current++; active.current = false; stopVoice(); setSpeaking(null) } else void play()
  }

  // The editor calls this on the student's first pointer-down inside it.
  useEffect(() => {
    autoplayRef.current = () => { if (!solved && !isMuted()) void play() }
    return () => { autoplayRef.current = null }
  }, [autoplayRef, solved, play])

  if (!lines.length) return null
  const first = lines[0]
  const speakers = [...new Set(lines.map(l => l.speaker ?? 'AURORA'))].join(' · ')

  return (
    <div className="mb-2 w-full min-w-0 overflow-hidden rounded-lg border bg-muted/20 text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          title={open ? 'Collapse briefing' : 'Show briefing'}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="shrink-0">Briefing · {speakers}</span>
          {!open && <span className="min-w-0 truncate font-normal normal-case tracking-normal">{solved ? '✓ ' : ''}{first.text}</span>}
        </button>
        {!muted && (
          <button
            onClick={toggle}
            className={cn('flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs hover:bg-muted', speaking !== null && 'bg-muted')}
            title={speaking !== null ? 'Stop' : 'Play briefing'}
          >
            {speaking !== null ? <Square className="h-3 w-3" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{speaking !== null ? 'Stop' : 'Listen'}</span>
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {lines.map((line, i) => {
            const speaker = line.speaker ?? 'AURORA'
            const portrait = karaPortrait(speaker, assets)
            return (
              <div key={i} className={cn('flex items-start gap-3 rounded-md transition-colors', speaking === i && 'bg-amber-50 dark:bg-amber-950/30')}>
                {portrait
                  // eslint-disable-next-line @next/next/no-img-element -- skript file URL, sized by CSS
                  ? <img src={portrait} alt={speaker} className="h-12 w-12 shrink-0 rounded-md object-cover sm:h-14 sm:w-14" />
                  : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-lg font-bold sm:h-14 sm:w-14">{speaker[0]}</div>}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{speaker}</div>
                  <p className="m-0 leading-snug whitespace-pre-wrap break-words">{line.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
