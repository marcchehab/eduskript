/**
 * POST { pageId, speaker, text } → a fresh gpt-audio take of the line as WAV.
 * For authors tuning Kara voice lines in a level (kara-voice-editor.tsx).
 * Nothing is stored; keeping a take is /api/kara/voice-pick. Edit right on
 * the page and a paid plan required (every call costs OpenRouter credits).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { editablePageContent } from '@/lib/kara/kara-lines.server'
import { KARA_VOICES } from '@/lib/kara/voice-lines'
import { tts, wav } from '@/lib/kara/voice-tts.server'

const MAX_TEXT = 600

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, speaker, text } = (await request.json().catch(() => ({}))) as { pageId?: string; speaker?: string; text?: string }
  const v = speaker ? KARA_VOICES[speaker.toUpperCase()] : undefined
  if (!pageId || !v || !text?.trim() || text.length > MAX_TEXT) {
    return NextResponse.json({ error: 'pageId, a voiced speaker and text (max 600 chars) required' }, { status: 400 })
  }
  if ((await editablePageContent(pageId, session.user.id, session.user.isAdmin)) === null) {
    return NextResponse.json({ error: 'You cannot edit this page.' }, { status: 403 })
  }
  if (!isPaidUser(session.user)) return paidOnlyResponse('Voice takes are a paid feature.')
  try {
    const t = await tts(text, v.voice, v.style)
    return new NextResponse(new Uint8Array(wav(t.pcm)), { headers: { 'content-type': 'audio/wav' } })
  } catch (e) {
    console.error('[kara/voice-take]', e)
    return NextResponse.json({ error: 'Voice rendering failed. Try again.' }, { status: 502 })
  }
}
