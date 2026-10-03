'use client'

/**
 * Level briefing above a Kara editor (`intro:` lines of the kara-world block,
 * see src/lib/kara/world.ts), always shown in full (no collapsing): a short
 * chat-style dialogue, portrait with the speaker's name below it and each
 * line in a speech bubble (KaraPortrait; AURORA's mark animates while she
 * speaks). Listen speaks the lines in order (skript `audio=` file, else the
 * cached TTS line; speakers without a voice are skipped). Nothing plays on
 * page load: the editor calls `autoplayRef` on the student's first
 * pointer-down inside it, which plays the dialogue once unless the level is
 * already solved (saved stars > 0, src/lib/kara/progress.ts) or the page is muted.
 */

import { displayText } from '@/lib/kara/voice-directions'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Square, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KaraPortrait } from './kara-portrait'
import { KaraVoiceEditor } from './kara-voice-editor'
import { usePageCanEdit } from '@/hooks/use-page-can-edit'
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
  /** Raw kara-world block and page: page authors get the voice-line editor (kara-voice-editor.tsx). */
  block?: string
  pageId?: string
  /** Called with the saved block after an in-place edit. */
  onBlockChange?: (block: string) => void
}

export function KaraIntro({ lines, assets, levelId, skriptId, autoplayRef, block, pageId, onBlockChange }: KaraIntroProps) {
  const canEdit = usePageCanEdit(block ? pageId : undefined)
  const [editing, setEditing] = useState(false)
  const [solved, setSolved] = useState(false)
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
        const started = playVoice(url, speaker, () => { off(); resolve(true) }, text)
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

  if (!lines.length && !canEdit) return null

  return (
    <div className="mb-2 w-full min-w-0 overflow-hidden rounded-lg border bg-muted/20 text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Briefing</span>
        {canEdit && (
          <button
            onClick={() => setEditing(e => !e)}
            className={cn('flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs hover:bg-muted', editing && 'bg-muted')}
            title="Edit AURORA's lines of this level (authors only)"
            aria-pressed={editing}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Voice lines</span>
          </button>
        )}
        {!muted && lines.length > 0 && (
          <button
            onClick={toggle}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs font-medium',
              speaking !== null ? 'bg-muted hover:bg-muted/80' : 'bg-amber-400 text-amber-950 hover:bg-amber-300',
            )}
            title={speaking !== null ? 'Stop' : 'Play briefing'}
          >
            {speaking !== null ? <Square className="h-3 w-3" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{speaking !== null ? 'Stop' : 'Listen'}</span>
          </button>
        )}
      </div>
      {/* Chat-style: portrait with the name below it, the line in a speech bubble. */}
      <div className="flex flex-col gap-2 px-3 pb-3">
        {lines.map((line, i) => {
          const speaker = line.speaker ?? 'AURORA'
          const sameAsBefore = i > 0 && (lines[i - 1].speaker ?? 'AURORA') === speaker
          return (
            <div key={i} className="flex items-start gap-3">
              <div className="flex w-14 shrink-0 flex-col items-center gap-1 sm:w-16">
                {!sameAsBefore && (
                  <>
                    <KaraPortrait speaker={speaker} assets={assets} speaking={speaking === i} className="h-12 w-12 sm:h-14 sm:w-14" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{speaker}</span>
                  </>
                )}
              </div>
              <div
                className={cn(
                  'relative min-w-0 max-w-[85%] rounded-2xl rounded-tl-sm border bg-background px-3.5 py-2 text-[1rem] leading-normal shadow-sm transition-colors',
                  speaking === i && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30',
                )}
              >
                <div className="whitespace-pre-wrap break-words">{displayText(line.text)}</div>
              </div>
            </div>
          )
        })}
      </div>
      {editing && canEdit && block && pageId && <KaraVoiceEditor block={block} pageId={pageId} onBlockChange={onBlockChange} />}
    </div>
  )
}
