/**
 * Voiced Kara lines: which speakers have a voice and where their pre-rendered
 * MP3s live (raw voice; effects are added client-side, see voice-fx.ts). The files are generated OFFLINE (TTS + effect + upload) by
 * ~/Documents/2_Areas/eduskript/kara-kurs/voices.ts — the server only looks
 * them up (no TTS calls, no ffmpeg on the app instance). The key covers voice,
 * style, effect and text, so changing any of them needs a re-render.
 */

import { createHash } from 'crypto'

export interface KaraVoice {
  /** openai/gpt-audio voice */
  voice: string
  /** spoken style instruction */
  style: string
  /** optional ffmpeg -af chain baked in offline ('' = none, the default) */
  fx: string
}

/** Speaker (upper-case) → voice. Speakers not listed get no audio. */
export const KARA_VOICES: Record<string, KaraVoice> = {
  AURORA: {
    voice: 'marin',
    style: 'Du bist AURORA, die Schiffs-KI der Mikroweich AG: arrogant, gelangweilt, passiv-aggressiv, höflich in der Form und vernichtend im Inhalt, wie eine Hotline-Ansage mit Verachtung. Trocken, kleine Pause vor der Pointe.',
    // Raw voice: the effect is applied in the browser (voice-fx.ts), so the
    // same sound works for lines generated later at runtime.
    fx: '',
  },
}

/** Content hash used as teacher-bucket file name (`files/<hash>.mp3`). */
export function voiceLineHash(speaker: string, text: string): string | null {
  const v = KARA_VOICES[speaker.toUpperCase()]
  if (!v) return null
  return createHash('sha256').update(`gpt-audio|${v.voice}|${v.style}|fx:${v.fx}|${text}`).digest('hex')
}
