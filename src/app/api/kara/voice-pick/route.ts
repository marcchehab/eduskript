/**
 * POST { pageId, speaker, text, audio } — store a take (base64 WAV from
 * /api/kara/voice-take) as the voice of a Kara line (saveVoiceTake), so the
 * level plays exactly that take. The text must be a line of this page as it
 * is saved now (save the text first, then pick).
 *
 * Known limitation: takes are keyed by speaker + text, not by page. Another
 * level with the identical line (any author) plays the same take.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { editablePageContent, isLineOfContent } from '@/lib/kara/kara-lines.server'
import { saveVoiceTake } from '@/lib/kara/voice-tts.server'

const MAX_AUDIO = 8_000_000 // base64 chars ≈ 6 MB WAV ≈ 2 min at 24 kHz mono

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { pageId, speaker, text, audio } = (await request.json().catch(() => ({}))) as { pageId?: string; speaker?: string; text?: string; audio?: string }
  if (!pageId || !speaker || !text || !audio || audio.length > MAX_AUDIO) {
    return NextResponse.json({ error: 'pageId, speaker, text and audio required' }, { status: 400 })
  }
  const content = await editablePageContent(pageId, session.user.id, session.user.isAdmin)
  if (content === null) return NextResponse.json({ error: 'You cannot edit this page.' }, { status: 403 })
  if (!isPaidUser(session.user)) return paidOnlyResponse('Voice takes are a paid feature.')
  if (!isLineOfContent(content, speaker, text)) {
    return NextResponse.json({ error: 'This line is not on the page (yet). Save the text first.' }, { status: 409 })
  }
  const buf = Buffer.from(audio, 'base64')
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') return NextResponse.json({ error: 'audio must be a WAV file' }, { status: 400 })
  const url = await saveVoiceTake(speaker, text, buf)
  return NextResponse.json({ url })
}
