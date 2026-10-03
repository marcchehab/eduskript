/**
 * Dev-only: store a take from the AURORA lab (/dashboard/aurora-lab) as the
 * voice of a Kara line, so the level plays exactly that take
 * (saveVoiceTake in voice-tts.server.ts). Only for text that is a real Kara
 * line, character for character, including [..]/{..} directions.
 * POST { speaker, text, audio } — audio = base64 WAV.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isKaraLine } from '@/lib/kara/kara-lines.server'
import { saveVoiceTake } from '@/lib/kara/voice-tts.server'

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Only available in development' }, { status: 403 })
  }
  const { speaker, text, audio } = (await request.json().catch(() => ({}))) as { speaker?: string; text?: string; audio?: string }
  if (!speaker || !text || !audio) return NextResponse.json({ error: 'speaker, text, audio required' }, { status: 400 })
  if (!(await isKaraLine(speaker, text))) {
    return NextResponse.json({ error: 'No Kara level speaks this exact text (check every character, incl. directions)' }, { status: 404 })
  }
  const url = await saveVoiceTake(speaker, text, Buffer.from(audio, 'base64'))
  return NextResponse.json({ url })
}
