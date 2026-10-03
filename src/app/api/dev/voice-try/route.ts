/**
 * Dev-only: render one Kara voice line for the AURORA lab
 * (/dashboard/aurora-lab) and return it as WAV. Nothing is cached or
 * uploaded; every call is a fresh gpt-audio take (costs OpenRouter credits).
 * POST { speaker, text, style? } — `style` overrides the speaker's default.
 */

import { NextRequest, NextResponse } from 'next/server'
import { KARA_VOICES } from '@/lib/kara/voice-lines'
import { tts, wav } from '@/lib/kara/voice-tts.server'

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Only available in development' }, { status: 403 })
  }
  const { speaker, text, style } = (await request.json().catch(() => ({}))) as { speaker?: string; text?: string; style?: string }
  const v = speaker ? KARA_VOICES[speaker.toUpperCase()] : undefined
  if (!v || !text?.trim()) return NextResponse.json({ error: 'known speaker and text required' }, { status: 400 })
  try {
    const t = await tts(text, v.voice, style?.trim() || v.style)
    return new NextResponse(new Uint8Array(wav(t.pcm)), {
      headers: { 'content-type': 'audio/wav', 'x-transcript': encodeURIComponent(t.transcript) },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
