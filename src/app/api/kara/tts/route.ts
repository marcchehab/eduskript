/**
 * POST { speaker, text } → { url } of the voice line, or 404.
 *
 * Existing files (offline MP3 from voices.mts, or an earlier on-demand WAV)
 * are returned directly. A missing line is rendered on demand
 * (voice-tts.server.ts), but only when the exact text appears in some page's
 * content, so the endpoint cannot be used to synthesize arbitrary text.
 * That check is a `contains` scan over pages.content (no index, O(pages)),
 * and runs only on cache misses. Drafts count too, so authors hear lines
 * while previewing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { voiceLineUrl } from '@/lib/kara/voice-tts.server'

const MAX_TEXT = 600

export async function POST(request: NextRequest) {
  const { text, speaker } = (await request.json().catch(() => ({}))) as { text?: string; speaker?: string }
  if (!text || !speaker) return NextResponse.json({ error: 'text, speaker required' }, { status: 400 })

  let url = await voiceLineUrl(speaker, text, { render: false })
  if (!url && text.length <= MAX_TEXT) {
    const inContent = await prisma.page.findFirst({ where: { content: { contains: text } }, select: { id: true } })
    if (inContent) {
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
