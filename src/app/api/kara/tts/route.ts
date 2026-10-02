/**
 * POST { speaker, text } → { url } of the voice line, or 404.
 *
 * Existing files (offline MP3 from voices.mts, or an earlier on-demand WAV)
 * are returned directly. A missing line is rendered on demand
 * (voice-tts.server.ts), but only when it is a real Kara line: a built-in
 * AURORA default, or a message with this exact speaker and text in a
 * ```kara-world block of some page. The candidate pages come from a
 * `contains` scan over pages.content (no index, O(pages)); it runs only on
 * cache misses. Drafts count too, so authors hear lines while previewing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { voiceLineUrl } from '@/lib/kara/voice-tts.server'
import { DEFAULT_AURORA, karaMessages, parseKaraLevel } from '@/lib/kara/world'

const MAX_TEXT = 600

/** True when (speaker, text) is a line some Kara level or default actually speaks. */
async function isKaraLine(speaker: string, text: string): Promise<boolean> {
  const who = speaker.toUpperCase()
  if (who === 'AURORA' && Object.values(DEFAULT_AURORA).includes(text)) return true
  const pages = await prisma.page.findMany({
    where: { AND: [{ content: { contains: text } }, { content: { contains: '```kara-world' } }] },
    select: { content: true },
    take: 20,
  })
  for (const { content } of pages) {
    for (const m of content.matchAll(/```kara-world[^\n]*\n([\s\S]*?)```/g)) {
      if (karaMessages(parseKaraLevel(m[1])).some(msg => msg.text === text && msg.speaker?.toUpperCase() === who)) return true
    }
  }
  return false
}

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
