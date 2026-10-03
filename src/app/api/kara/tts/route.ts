/**
 * POST { speaker, text } → { url } of the voice line, or 404.
 *
 * Existing files (offline MP3 from voices.mts, or an earlier on-demand WAV)
 * are returned directly. A missing line is rendered on demand
 * (voice-tts.server.ts), but only when it is a real Kara line: a built-in
 * AURORA default (aurora-defaults.ts; also with {line}/{name} filled in), or a message with this exact speaker and text in a
 * ```kara-world block of some page. The candidate pages come from a
 * `contains` scan over pages.content (no index, O(pages)); it runs only on
 * cache misses. Drafts count too, so authors hear lines while previewing.
 * Limitation: a level line with {line}/{name} placeholders (aurora.lint.*)
 * is spoken filled in, so the page scan never finds it: no on-demand voice.
 */

import { NextRequest, NextResponse } from 'next/server'
import { voiceLineUrl } from '@/lib/kara/voice-tts.server'
import { isKaraLine } from '@/lib/kara/kara-lines.server'

const MAX_TEXT = 600

export async function POST(request: NextRequest) {
  const { text, speaker } = (await request.json().catch(() => ({}))) as { text?: string; speaker?: string }
  if (!text || !speaker) return NextResponse.json({ error: 'text, speaker required' }, { status: 400 })

  let url = await voiceLineUrl(speaker, text, { render: false })
  if (!url && text.length <= MAX_TEXT) {
    if (await isKaraLine(speaker, text)) {
      try {
        url = await voiceLineUrl(speaker, text, { render: true })
      } catch (e) {
        console.error('[kara/tts] render failed', e)
      }
    }
  }
  if (!url) return NextResponse.json({ error: 'no voice line' }, { status: 404 })
  return NextResponse.json({ url })
}
