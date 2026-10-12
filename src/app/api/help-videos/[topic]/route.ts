/**
 * GET /api/help-videos/[topic]
 *
 * Playback sources (src/lib/video-playback.ts) for one contextual help clip (see
 * src/lib/help-videos/store.ts). The clip is a skript-less `Video` row with
 * filename `help-<topic>.mp4`, uploaded via scripts/upload-onboarding-video.mjs.
 * 404 until a self-hosted row exists and is ready. Public: help links also
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

  const videos = await prisma.video.findMany({
    where: { filename: helpVideoFilename(topic), provider: 'self' },
    select: { provider: true, metadata: true },
  })
  const playback = videos
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
