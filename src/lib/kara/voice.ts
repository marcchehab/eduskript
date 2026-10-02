'use client'

/**
 * Plays Kara voice lines in the browser. Lines come either from a skript file
 * (`audio=` in the level config) or from the cached TTS route
 * (/api/kara/tts returns the cached raw line, rendering it on first request,
 * see src/lib/kara/voice-tts.server.ts).
 * The speaker's voice effect is applied live via Web Audio (voice-fx.ts).
 * One line plays at a time.
 */

let ctx: AudioContext | null = null
import { connectVoiceFx, VOICE_FX } from './voice-fx'
import { isMuted, onMuteChange } from '@/lib/sound'

// Lines play through an <audio> element (pitch-preserving `playbackRate`)
// routed into Web Audio for the effect chain. Needs CORS on the file host
// (the teacher bucket allows *).
let current: { el: HTMLAudioElement; stop: () => void } | null = null
let seq = 0 // latest playVoice call wins
const urlCache = new Map<string, Promise<string | null>>()

/** Shared AudioContext for Kara voices and effects (sfx.ts). */
export function audio(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** URL of a pre-rendered line; null when there is none. */
export function ttsLineUrl(speaker: string, text: string): Promise<string | null> {
  const key = `${speaker}|${text}`
  let p = urlCache.get(key)
  if (!p) {
    p = fetch('/api/kara/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speaker, text }),
    }).then(r => (r.ok ? r.json() : null)).then(j => j?.url ?? null).catch(() => null)
    urlCache.set(key, p)
  }
  return p
}

export function stopVoice() {
  seq++
  if (current) { current.el.pause(); current.stop(); current = null }
}

/** Play `url`, with the speaker's voice effect and speed (VOICE_FX) if it has one. */
export async function playVoice(url: string, speaker?: string): Promise<void> {
  stopVoice()
  if (isMuted()) return
  const token = seq
  const c = audio()
  const el = new Audio()
  el.crossOrigin = 'anonymous'
  el.src = url
  const fx = speaker ? VOICE_FX[speaker.toUpperCase()] : undefined
  el.preservesPitch = true
  el.playbackRate = fx?.rate ?? 1
  const src = c.createMediaElementSource(el)
  const stop = fx ? await connectVoiceFx(c, src, c.destination, fx) : (src.connect(c.destination), () => {})
  if (token !== seq) { stop(); return }
  el.onended = () => { stop(); src.disconnect() }
  current = { el, stop }
  await el.play()
}

// Muting the page stops a line that is already playing.
if (typeof window !== 'undefined') onMuteChange(() => { if (isMuted()) stopVoice() })
