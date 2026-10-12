/**
 * GET /api/help-videos/[topic]
 *
 * Playback sources (src/lib/video-playback.ts) for one contextual help clip (see
 * src/lib/help-videos/store.ts). The clip is a skript-less `Video` row with
 * filename `help-<topic>.mp4`, uploaded via scripts/upload-onboarding-video.mjs.
 * 404 until that row exists and is ready (Infomaniak or legacy Mux). Public: help links also
 * appear on public pages for anonymous visitors.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { helpVideoFilename, isValidHelpTopic } from '@/lib/help-videos/store'
import { getVideoPlayback } from '@/lib/video-playback'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ topic: string }> }
) {
  const { topic } = await params
  if (!isValidHelpTopic(topic)) {
    return NextResponse.json({ error: 'Invalid topic' }, { status: 400 })
  }

  // Prefer a migrated/new Infomaniak row over a leftover Mux one.
  const videos = await prisma.video.findMany({
    where: { filename: helpVideoFilename(topic) },
    select: { provider: true, metadata: true },
  })
  videos.sort((a, b) => Number(b.provider === 'infomaniak') - Number(a.provider === 'infomaniak'))
  const playback = videos
    .filter(v => (v.metadata as Record<string, unknown> | null)?.status === 'ready')
    .map(v => getVideoPlayback(v.provider, v.metadata as Record<string, unknown>))
    .find(p => p !== null)
  if (!playback) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(
    playback,
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
