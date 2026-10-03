'use client'

import { useState } from 'react'
import { Check, Copy, Loader2, Play, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { playVoice, stopVoice } from '@/lib/kara/voice'
import { displayText } from '@/lib/kara/voice-directions'

interface Take { id: number; speaker: string; text: string; style: string; url: string; transcript: string; fx: boolean; saved?: 'busy' | 'ok' | string }

const EXAMPLE = '[trocken, gelangweilt] Programm beendet. {Pause} Ziel nicht erreicht. {schnell, beiläufig} Wie immer eigentlich. {/}'

export function AuroraLab({ voices }: { voices: Record<string, string> }) {
  const speakers = Object.keys(voices)
  const [speaker, setSpeaker] = useState(speakers[0] ?? 'AURORA')
  const [text, setText] = useState(EXAMPLE)
  const [style, setStyle] = useState(voices[speakers[0]] ?? '')
  const [fx, setFx] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [takes, setTakes] = useState<Take[]>([])

  const play = (t: Take) => void playVoice(t.url, t.fx ? t.speaker : undefined, undefined, t.text)
  const patch = (id: number, saved: Take['saved']) => setTakes(ts => ts.map(t => (t.id === id ? { ...t, saved } : t)))

  /** Make this take the voice of the level line with exactly this text. */
  async function storeForPage(t: Take) {
    patch(t.id, 'busy')
    try {
      const bytes = new Uint8Array(await (await fetch(t.url)).arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const r = await fetch('/api/dev/voice-save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ speaker: t.speaker, text: t.text, audio: btoa(bin) }),
      })
      const j = await r.json().catch(() => null)
      patch(t.id, r.ok ? 'ok' : (j?.error ?? `HTTP ${r.status}`))
    } catch (e) {
      patch(t.id, e instanceof Error ? e.message : String(e))
    }
  }

  async function render() {
    if (busy || !text.trim()) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/dev/voice-try', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ speaker, text, style: style === voices[speaker] ? undefined : style }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`)
      const url = URL.createObjectURL(await r.blob())
      const take: Take = { id: Date.now(), speaker, text, style, url, transcript: decodeURIComponent(r.headers.get('x-transcript') ?? ''), fx }
      setTakes(ts => [take, ...ts])
      play(take)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">AURORA lab</h1>
        <p className="text-sm text-muted-foreground">
          <code>[…]</code> at the start = whole line (tone, tempo). <code>{'{…}'}</code> in the text = from here until <code>{'{/}'}</code> or the end of the sentence, e.g. <code>{'{Pause}'}</code>, <code>{'{schnell}'}</code>, <code>{'{flüsternd}'}</code>, <code>{'{betont: Wort}'}</code>. Every render is a fresh take (paid). «Use for page» stores a take as the voice of the level line; the text must match the level line exactly.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <select className="rounded border bg-background px-2 py-1" value={speaker} onChange={e => { setSpeaker(e.target.value); setStyle(voices[e.target.value]) }}>
            {speakers.map(s => <option key={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fx} onChange={e => setFx(e.target.checked)} /> voice effect
          </label>
        </div>
        <textarea
          className="h-32 w-full rounded border bg-background p-3 font-mono text-sm"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void render() } }}
        />
        <p className="text-sm"><span className="text-muted-foreground">On screen: </span>{displayText(text)}</p>
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Base style (speaker default; edit to experiment)</summary>
          <textarea className="mt-2 h-24 w-full rounded border bg-background p-3 text-sm" value={style} onChange={e => setStyle(e.target.value)} />
        </details>
        <div className="flex items-center gap-3">
          <Button onClick={render} disabled={busy} title="Render (Ctrl+Enter)">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {busy ? 'Rendering…' : 'Render'}
          </Button>
          <Button variant="outline" onClick={stopVoice}>Stop</Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      </div>

      <div className="space-y-2">
        {takes.map(t => (
          <div key={t.id} className="flex items-start gap-3 rounded border p-3">
            <Button size="icon" variant="outline" onClick={() => play(t)} title="Play"><Play className="h-4 w-4" /></Button>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-mono">{t.text}</p>
              <p className="text-muted-foreground">heard: {t.transcript || '—'}</p>
              {t.saved && t.saved !== 'busy' && t.saved !== 'ok' && <p className="text-destructive">{t.saved}</p>}
              {t.saved === 'ok' && <p className="text-green-600 dark:text-green-400">The level now plays this take (reload the level page).</p>}
            </div>
            <Button size="sm" variant="outline" onClick={() => void storeForPage(t)} disabled={t.saved === 'busy'} title="Store this take as the voice of the level line with exactly this text">
              {t.saved === 'busy' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : t.saved === 'ok' ? <Check className="mr-1 h-4 w-4" /> : <Upload className="mr-1 h-4 w-4" />}
              Use for page
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void navigator.clipboard.writeText(t.text)} title="Copy line"><Copy className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  )
}
