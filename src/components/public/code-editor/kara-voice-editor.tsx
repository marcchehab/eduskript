'use client'

/**
 * In-place editor for a level's AURORA lines, shown to page authors under the
 * briefing (KaraIntro, pencil button). Lists every AURORA line of the
 * kara-world block plus the course defaults it does not override
 * (auroraVoiceLines). Per line: edit the text (with spoken directions, see
 * voice-directions.ts), play the current voice, render fresh takes
 * (/api/kara/voice-take, nothing stored), and «Use» one: the text is saved
 * into the page first if it changed (exact-text replace of the whole block,
 * /api/pages/[id]/replace), then the take becomes the line's voice
 * (/api/kara/voice-pick). The saved block goes back up (onBlockChange), so the
 * level shows it at once; router.refresh() would remount the editor.
 *
 * Takes live only in this component (object URLs); they are lost on reload.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Mic, Play, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { displayText, hasDirections } from '@/lib/kara/voice-directions'
import { auroraVoiceLines, setVoiceLine, type VoiceLine } from '@/lib/kara/voice-line-edit'
import { forgetTtsLine, playVoice, ttsLineUrl } from '@/lib/kara/voice'

const SPEAKER = 'AURORA'
/** Runtime placeholders are filled when the line is spoken; such lines get no stored voice. */
const PLACEHOLDER = /\{(line|name|got|want)\}/

interface Take { url: string; n: number }

const lineId = (l: VoiceLine) => `${l.key}#${l.index}`

async function errorOf(r: Response): Promise<string> {
  const j = await r.json().catch(() => null)
  if (r.status === 402) return 'Voice takes need a paid plan.'
  return j?.error ?? `HTTP ${r.status}`
}

export function KaraVoiceEditor({ block, pageId, onBlockChange }: { block: string; pageId: string; onBlockChange?: (block: string) => void }) {
  const lines = auroraVoiceLines(block)
  const own = lines.filter(l => !l.isDefault)
  const defaults = lines.filter(l => l.isDefault)
  return (
    <div className="flex flex-col gap-3 border-t px-3 py-3">
      <div className="text-xs leading-snug text-muted-foreground">
        <code>[…]</code> at the start = tone for the whole line, <code>{'{…}'}</code> = direction from there on. Directions are not shown on screen. «Use» saves the text into the page and makes that take the line&apos;s voice.
      </div>
      {own.map(l => <LineRow key={lineId(l)} line={l} block={block} pageId={pageId} onSaved={b => onBlockChange?.(b)} />)}
      {defaults.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Course defaults this level does not override ({defaults.length})</summary>
          <div className="mt-2 flex flex-col gap-3">
            {defaults.map(l => <LineRow key={lineId(l)} line={l} block={block} pageId={pageId} onSaved={b => onBlockChange?.(b)} />)}
          </div>
        </details>
      )}
    </div>
  )
}

function LineRow({ line, block, pageId, onSaved }: { line: VoiceLine; block: string; pageId: string; onSaved: (block: string) => void }) {
  const [draft, setDraft] = useState(line.text)
  const [takes, setTakes] = useState<Take[]>([])
  const [busy, setBusy] = useState<'take' | 'save' | number | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Off = play raw (no voice effect, no tempo change), to tell file artefacts from the effect chain.
  const [fx, setFx] = useState(true)
  const play = (url: string) => void playVoice(url, fx ? SPEAKER : undefined)
  // A refresh after saving brings the new block: follow the saved text.
  useEffect(() => { setDraft(line.text) }, [line.text])
  // Revoke take URLs on unmount only (a cleanup per takes change would revoke the older ones).
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), [])

  const dirty = draft.trim() !== line.text
  const voiceless = PLACEHOLDER.test(draft)

  /** Save `text` into the page; returns the saved (cleaned) text or null on error. */
  async function saveText(text: string): Promise<string | null> {
    let next: string
    try { next = setVoiceLine(block, line.key, line.index, text) } catch (e) { setMsg({ ok: false, text: (e as Error).message }); return null }
    const r = await fetch(`/api/pages/${pageId}/replace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ old: block, new: next }),
    })
    if (!r.ok) { setMsg({ ok: false, text: await errorOf(r) }); return null }
    onSaved(next)
    return text.replace(/\s*\n\s*/g, ' ').trim()
  }

  async function onSave() {
    setBusy('save'); setMsg(null)
    const saved = await saveText(draft)
    setBusy(null)
    if (saved !== null) setMsg({ ok: true, text: 'Saved.' })
  }

  async function onTake() {
    setBusy('take'); setMsg(null)
    try {
      const r = await fetch('/api/kara/voice-take', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId, speaker: SPEAKER, text: draft.trim() }),
      })
      if (!r.ok) { setMsg({ ok: false, text: await errorOf(r) }); return }
      const take = { url: URL.createObjectURL(await r.blob()), n: takes.length + 1 }
      urls.current.push(take.url)
      setTakes(ts => [...ts, take])
      play(take.url)
    } finally { setBusy(null) }
  }

  async function onUse(take: Take) {
    setBusy(take.n); setMsg(null)
    try {
      let text = line.text
      if (dirty || line.isDefault) {
        const saved = await saveText(draft)
        if (saved === null) return
        text = saved
      }
      const bytes = new Uint8Array(await (await fetch(take.url)).arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const r = await fetch('/api/kara/voice-pick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId, speaker: SPEAKER, text, audio: btoa(bin) }),
      })
      if (!r.ok) { setMsg({ ok: false, text: await errorOf(r) }); return }
      forgetTtsLine(SPEAKER, text)
      setMsg({ ok: true, text: `Take ${take.n} is now the voice of this line.` })
    } finally { setBusy(null) }
  }

  async function onPlayCurrent() {
    const url = await ttsLineUrl(SPEAKER, line.text)
    if (url) play(url)
    else setMsg({ ok: false, text: 'No voice for this line yet.' })
  }

  return (
    <div className="rounded-md border bg-background/60 p-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{line.key}{line.key === 'intro' ? ` ${line.index + 1}` : ''}</span>
        {line.isDefault && <span className="rounded bg-muted px-1 normal-case tracking-normal">default</span>}
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={2}
        className="w-full resize-y rounded border bg-background p-2 font-mono text-xs"
      />
      {hasDirections(draft) && <div className="mt-1 text-xs text-muted-foreground">On screen: {displayText(draft)}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!PLACEHOLDER.test(line.text) && (
          <button onClick={() => void onPlayCurrent()} className="flex h-7 items-center gap-1 rounded px-2 text-xs hover:bg-muted" title="Play the current voice of the saved line">
            <Play className="h-3.5 w-3.5" /> Current
          </button>
        )}
        <button
          onClick={() => void onTake()}
          disabled={busy !== null || voiceless || !draft.trim()}
          className="flex h-7 items-center gap-1 rounded bg-amber-400 px-2 text-xs font-medium text-amber-950 hover:bg-amber-300 disabled:opacity-50"
          title={voiceless ? 'Lines with {line}/{name}/{got}/{want} are filled in at runtime and get no stored voice' : 'Render a fresh take of the text above (costs credits)'}
        >
          {busy === 'take' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />} New take
        </button>
        {dirty && (
          <button onClick={() => void onSave()} disabled={busy !== null} className="flex h-7 items-center gap-1 rounded border px-2 text-xs hover:bg-muted disabled:opacity-50" title="Save the text into the page (voice is rendered on first play)">
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save text
          </button>
        )}
        {takes.map(t => (
          <span key={t.n} className="flex items-center overflow-hidden rounded border text-xs">
            <button onClick={() => play(t.url)} className="flex h-7 items-center gap-1 px-2 hover:bg-muted" title={`Play take ${t.n}`}>
              <Play className="h-3 w-3" /> {t.n}
            </button>
            <button onClick={() => void onUse(t)} disabled={busy !== null} className="flex h-7 items-center gap-1 border-l px-2 hover:bg-muted disabled:opacity-50" title="Save the text and use this take as the line's voice">
              {busy === t.n ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Use
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-start gap-2">
        {msg && <div className={cn('flex-1 text-xs', msg.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>{msg.text}</div>}
        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground" title="Off: play the raw recording, without voice effect and tempo change">
          <input type="checkbox" checked={fx} onChange={e => setFx(e.target.checked)} className="h-3 w-3" /> voice effect
        </label>
      </div>
    </div>
  )
}
