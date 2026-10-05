'use client'

/**
 * Speaker portrait for Kara briefings and the message bar. AURORA (without a
 * skript `portrait-aurora.png` override) is drawn as the trailer's mark: four
 * Mikroweich-coloured arcs around a core (see ~/coding/mop7-trailer/scripts/screens.py,
 * aurora_symbol). While her line plays, the arcs turn and the core pulses with
 * the voice loudness (voiceLevel(), read once per animation frame).
 * Other speakers: portrait image (karaPortrait) or their initial.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { karaPortrait } from '@/lib/kara/portraits'
import { onVoiceSpeakerChange, speakingKey, voiceLevel, voiceSpeaker } from '@/lib/kara/voice'

const ARC_COLOURS = ['#f25022', '#7fba00', '#00a4ef', '#ffb900']

/** SVG path of a circle arc from a0 to a1 degrees (clockwise from 3 o'clock, like PIL). */
function arc(r: number, a0: number, a1: number): string {
  const p = (a: number) => `${50 + r * Math.cos((a * Math.PI) / 180)} ${50 + r * Math.sin((a * Math.PI) / 180)}`
  return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`
}

function AuroraMark({ speaking, className }: { speaking: boolean; className?: string }) {
  const core = useRef<SVGCircleElement>(null)
  const glow = useRef<SVGCircleElement>(null)
  useEffect(() => {
    const c = core.current, g = glow.current
    if (!speaking || !c || !g) return
    let raf = 0
    let smooth = 0
    const tick = () => {
      smooth += (voiceLevel() - smooth) * 0.35
      const r = 12 + 9 * smooth
      c.setAttribute('r', String(r))
      g.setAttribute('r', String(r * 1.9))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      c.setAttribute('r', '12')
      g.setAttribute('r', '22.8')
    }
  }, [speaking])
  return (
    <svg viewBox="0 0 100 100" className={cn('shrink-0 rounded-md bg-[#0a1020]', className)} role="img" aria-label="AURORA">
      <defs>
        <filter id="aurora-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <g className={cn('origin-center', speaking && 'animate-[spin_5s_linear_infinite]')}>
        {ARC_COLOURS.map((c, i) => (
          <g key={c}>
            <path d={arc(36, i * 90 + 6, i * 90 + 84)} stroke={c} strokeWidth="13" fill="none" opacity="0.6" filter="url(#aurora-blur)" />
            <path d={arc(36, i * 90 + 6, i * 90 + 84)} stroke={c} strokeWidth="7" fill="none" />
          </g>
        ))}
      </g>
      <circle ref={glow} cx="50" cy="50" r="22.8" fill="#e6f0ff" opacity="0.45" filter="url(#aurora-blur)" />
      <circle ref={core} cx="50" cy="50" r="12" fill="#e6f0ff" />
    </svg>
  )
}

/** True while this exact line (speaker + text as written) is playing; other lines of the same speaker do not count. */
export function useSpeaking(speaker: string | undefined, text: string | undefined): boolean {
  const now = useSyncExternalStore(onVoiceSpeakerChange, voiceSpeaker, () => null)
  return !!speaker && text !== undefined && now === speakingKey(speaker, text)
}

export function KaraPortrait({ speaker, assets, speaking, className }: { speaker: string; assets?: Record<string, string>; speaking?: boolean; className?: string }) {
  const custom = assets?.[`portrait:${speaker.toLowerCase()}`]
  if (speaker.toUpperCase() === 'AURORA' && !custom) return <AuroraMark speaking={!!speaking} className={className} />
  const portrait = karaPortrait(speaker, assets)
  return portrait
    // eslint-disable-next-line @next/next/no-img-element -- skript file URL, sized by CSS
    ? <img src={portrait} alt={speaker} className={cn('shrink-0 rounded-md object-cover', className)} />
    : <div className={cn('flex shrink-0 items-center justify-center rounded-md bg-muted text-lg font-bold', className)}>{speaker[0]}</div>
}

/**
 * Marks a whole line that contains an ad (`{werbung}`, voice-directions.ts
 * isAd): the wrapped text is italic and a vertical «Werbung» label runs down
 * the right edge, so students see it is not meant seriously. The label text
 * is German on purpose (the teacher asked for it; it is part of the course
 * fiction, not app UI). While the line is spoken, callers put
 * `.kara-ad-disco` (globals.css) on the surrounding box so the disco
 * spotlights fill all of it.
 */
export function AdMark({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-stretch gap-3" title="Werbung, nicht ernst gemeint">
      <div className="min-w-0 flex-1 italic">{children}</div>
      <span
        aria-hidden
        className="flex shrink-0 select-none items-center justify-center border-l border-dashed pl-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground [writing-mode:vertical-rl]"
      >
        Werbung
      </span>
    </div>
  )
}
