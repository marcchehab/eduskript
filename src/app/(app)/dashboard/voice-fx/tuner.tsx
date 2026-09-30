'use client'

import { useEffect, useRef, useState } from 'react'
import { connectVoiceFx, VOICE_FX, type VoiceFx } from '@/lib/kara/voice-fx'

const TUNER = 'http://localhost:8770'
const TRAILER_FFMPEG = 'highpass=f=200,lowpass=f=8000,afreqshift=shift=25,chorus=0.7:0.9:18:0.3:0.3:2,aecho=0.8:0.4:20:0.15'

type Slider = [label: string, get: (f: VoiceFx) => number, set: (f: VoiceFx, v: number) => void, min: number, max: number, step: number]

const GROUPS: { title: string; toggle?: [(f: VoiceFx) => boolean, (f: VoiceFx, on: boolean) => void]; sliders: Slider[] }[] = [
  { title: 'Filter', sliders: [
    ['highpass Hz (0 = aus)', f => f.highpass, (f, v) => { f.highpass = v }, 0, 800, 5],
    ['lowpass Hz (0 = aus)', f => f.lowpass, (f, v) => { f.lowpass = v }, 0, 16000, 100],
    ['bass dB', f => f.bass.gain, (f, v) => { f.bass.gain = v }, -12, 15, 0.5],
    ['bass Hz', f => f.bass.freq, (f, v) => { f.bass.freq = v }, 40, 400, 5],
    ['freq shift Hz', f => f.shift, (f, v) => { f.shift = v }, -200, 200, 1],
    ['volume', f => f.volume, (f, v) => { f.volume = v }, 0.2, 3, 0.05],
    ['speed (rate)', f => f.rate, (f, v) => { f.rate = v }, 0.7, 1.6, 0.01],
  ] },
  { title: 'Chorus', toggle: [f => !!f.chorus, (f, on) => { f.chorus = on ? { in: 0.7, out: 0.9, delay: 18, decay: 0.3, speed: 0.3, depth: 2 } : null }], sliders: [
    ['in', f => f.chorus?.in ?? 0, (f, v) => { if (f.chorus) f.chorus.in = v }, 0.1, 1, 0.05],
    ['out', f => f.chorus?.out ?? 0, (f, v) => { if (f.chorus) f.chorus.out = v }, 0.1, 1.5, 0.05],
    ['delay ms', f => f.chorus?.delay ?? 0, (f, v) => { if (f.chorus) f.chorus.delay = v }, 2, 80, 1],
    ['decay (wet)', f => f.chorus?.decay ?? 0, (f, v) => { if (f.chorus) f.chorus.decay = v }, 0, 1, 0.05],
    ['speed Hz', f => f.chorus?.speed ?? 0, (f, v) => { if (f.chorus) f.chorus.speed = v }, 0.05, 8, 0.05],
    ['depth ms', f => f.chorus?.depth ?? 0, (f, v) => { if (f.chorus) f.chorus.depth = v }, 0, 15, 0.5],
  ] },
  { title: 'Echo', toggle: [f => !!f.echo, (f, on) => { f.echo = on ? { in: 0.8, out: 0.4, delay: 20, decay: 0.15 } : null }], sliders: [
    ['in', f => f.echo?.in ?? 0, (f, v) => { if (f.echo) f.echo.in = v }, 0.1, 1, 0.05],
    ['out', f => f.echo?.out ?? 0, (f, v) => { if (f.echo) f.echo.out = v }, 0.05, 1.5, 0.05],
    ['delay ms', f => f.echo?.delay ?? 0, (f, v) => { if (f.echo) f.echo.delay = v }, 5, 500, 1],
    ['decay', f => f.echo?.decay ?? 0, (f, v) => { if (f.echo) f.echo.decay = v }, 0, 1, 0.05],
  ] },
]

export function VoiceFxTuner() {
  const [samples, setSamples] = useState<{ file: string; label: string }[]>([])
  const [sample, setSample] = useState('')
  const [fx, setFx] = useState<VoiceFx>(() => structuredClone(VOICE_FX.AURORA))
  const [auto, setAuto] = useState(true)
  const [status, setStatus] = useState('')
  const ctxRef = useRef<AudioContext | null>(null)
  const elRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    fetch(`${TUNER}/samples`).then(r => r.json()).then(s => { setSamples(s); setSample(s[0]?.file ?? '') })
      .catch(() => setStatus('fx-tuner.py läuft nicht (Port 8770)'))
  }, [])

  const stop = () => { elRef.current?.pause() }

  // Same path as the game (src/lib/kara/voice.ts): <audio> with pitch-preserving
  // playbackRate → Web Audio effect chain.
  const play = async (withFx: boolean, f = fx) => {
    if (!sample) return
    stop()
    ctxRef.current ??= new AudioContext()
    const ctx = ctxRef.current
    const el = new Audio(); el.crossOrigin = 'anonymous'; el.src = `${TUNER}/raw/${sample}`
    el.preservesPitch = true; el.playbackRate = withFx ? f.rate : 1
    const src = ctx.createMediaElementSource(el)
    if (withFx) { const s = await connectVoiceFx(ctx, src, ctx.destination, f); el.onended = s }
    else src.connect(ctx.destination)
    elRef.current = el; void el.play()
    setStatus(withFx ? 'Browser-Effekt' : 'roh')
  }

  const playFfmpeg = async () => {
    stop()
    const r = await fetch(`${TUNER}/render`, { method: 'POST', body: JSON.stringify({ file: sample, fx: TRAILER_FFMPEG }) })
    const el = new Audio(URL.createObjectURL(await r.blob())); elRef.current = el; void el.play()
    setStatus('ffmpeg-Referenz (Trailer)')
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const update = (mutate: (f: VoiceFx) => void) => {
    const next = structuredClone(fx); mutate(next); setFx(next)
    if (auto) { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void play(true, next), 400) }
  }

  const json = JSON.stringify(fx, null, 2)
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">Voice FX Tuner (Browser / Web Audio)</h1>
      <p className="text-sm text-muted-foreground">Gleiche Effektkette wie im Spiel (src/lib/kara/voice-fx.ts). ffmpeg nur als Vergleich.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={sample} onChange={e => setSample(e.target.value)} className="max-w-xl rounded border bg-background p-1.5 text-sm">
          {samples.map(s => <option key={s.file} value={s.file}>{s.label}</option>)}
        </select>
        <button onClick={() => void play(false)} className="rounded border px-3 py-1.5 text-sm">▶ roh</button>
        <button onClick={() => void play(true)} className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">▶ Browser-Effekt</button>
        <button onClick={() => void playFfmpeg()} className="rounded border px-3 py-1.5 text-sm">▶ ffmpeg-Referenz</button>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> automatisch abspielen</label>
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {GROUPS.map(g => {
          const on = g.toggle ? g.toggle[0](fx) : true
          return (
            <div key={g.title} className={`rounded border p-3 ${on ? '' : 'opacity-50'}`}>
              <div className="mb-2 flex items-center gap-2 font-semibold">
                {g.toggle && <input type="checkbox" checked={on} onChange={e => update(f => g.toggle![1](f, e.target.checked))} />}
                {g.title}
              </div>
              {g.sliders.map(([label, get, set, min, max, step]) => (
                <label key={label} className="grid grid-cols-[110px_1fr_44px] items-center gap-2 text-xs text-muted-foreground">
                  {label}
                  <input type="range" min={min} max={max} step={step} value={get(fx)} disabled={!on} onChange={e => update(f => set(f, Number(e.target.value)))} />
                  <span className="tabular-nums">{get(fx)}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          Einstellungen <button onClick={() => void navigator.clipboard.writeText(json)} className="rounded border px-2 py-0.5 text-xs font-normal">Kopieren</button>
        </div>
        <pre className="overflow-auto rounded border bg-muted/30 p-2 text-xs">{json}</pre>
      </div>
    </div>
  )
}
