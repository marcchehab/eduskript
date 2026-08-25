/**
 * GET /api/onboarding-quest/step-videos
 *
 * Returns Mux playback metadata for the onboarding quest's tutorial clips,
 * keyed by QuestStep. Videos are skript-less `Video` rows (see
 * POST /api/admin/videos) with the stable filename `onboarding-<step>.mp4` —
 * swapping a clip later is just re-running scripts/upload-onboarding-video.mjs
 * with the same filename, no code change. Public (no auth): the widget only
 * mounts for logged-in teachers, but the clips themselves aren't sensitive.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { QUEST_STEPS, type QuestStep } from '@/lib/onboarding-quest/types'

function filenameForStep(step: QuestStep): string {
  return `onboarding-${step.replaceAll('_', '-')}.mp4`
}

export async function GET() {
  const filenames = QUEST_STEPS.map(filenameForStep)

  const videos = await prisma.video.findMany({
    where: { filename: { in: filenames }, provider: 'mux' },
    select: { filename: true, metadata: true },
  })

  const byFilename = new Map(videos.map((v) => [v.filename, v.metadata as Record<string, unknown>]))

  const result: Partial<Record<QuestStep, { playbackId: string; poster?: string; aspectRatio?: number }>> = {}
  for (const step of QUEST_STEPS) {
    const metadata = byFilename.get(filenameForStep(step))
    const playbackId = metadata?.playbackId
    if (typeof playbackId === 'string' && metadata?.status === 'ready') {
      result[step] = {
        playbackId,
        poster: typeof metadata.poster === 'string' ? metadata.poster : undefined,
        aspectRatio: typeof metadata.aspectRatio === 'number' ? metadata.aspectRatio : undefined,
      }
    }
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=300' } })
}
