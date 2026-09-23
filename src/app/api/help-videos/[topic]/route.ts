/**
 * GET /api/help-videos/[topic]
 *
 * Mux playback metadata for one contextual help clip (see
 * src/lib/help-videos/store.ts). The clip is a skript-less `Video` row with
 * filename `help-<topic>.mp4`, uploaded via scripts/upload-onboarding-video.mjs.
 * 404 until that row exists and Mux reports it ready. Public: help links also
 * appear on public pages for anonymous visitors.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { helpVideoFilename, isValidHelpTopic } from '@/lib/help-videos/store'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ topic: string }> }
) {
  const { topic } = await params
  if (!isValidHelpTopic(topic)) {
    return NextResponse.json({ error: 'Invalid topic' }, { status: 400 })
  }

  const video = await prisma.video.findFirst({
    where: { filename: helpVideoFilename(topic), provider: 'mux' },
    select: { metadata: true },
  })
  const metadata = video?.metadata as Record<string, unknown> | undefined
  const playbackId = metadata?.playbackId
  if (typeof playbackId !== 'string' || metadata?.status !== 'ready') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(
    {
      playbackId,
      poster: typeof metadata.poster === 'string' ? metadata.poster : undefined,
      aspectRatio: typeof metadata.aspectRatio === 'number' ? metadata.aspectRatio : undefined,
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
