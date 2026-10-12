/**
 * GET /api/onboarding-quest/step-videos
 *
 * Returns playback sources (src/lib/video-playback.ts) for the onboarding quest's tutorial clips,
 * keyed by QuestStep. Videos are skript-less self-hosted `Video` rows with the
 * stable filename `onboarding-<step>.mp4` —
 * swapping a clip later is just re-running scripts/upload-onboarding-video.mjs
 * with the same filename, no code change. Public (no auth): the widget only
 * mounts for logged-in teachers, but the clips themselves aren't sensitive.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { QUEST_STEPS, type QuestStep } from '@/lib/onboarding-quest/types'
import { getVideoPlayback, type VideoPlayback } from '@/lib/video-playback'

function filenameForStep(step: QuestStep): string {
  return `onboarding-${step.replaceAll('_', '-')}.mp4`
}

export async function GET() {
  const filenames = QUEST_STEPS.map(filenameForStep)

  const videos = await prisma.video.findMany({
    where: { filename: { in: filenames }, provider: 'self' },
    select: { filename: true, provider: true, metadata: true },
  })

  const result: Partial<Record<QuestStep, VideoPlayback>> = {}
  for (const step of QUEST_STEPS) {
    for (const v of videos) {
      if (v.filename !== filenameForStep(step)) continue
      const playback = getVideoPlayback(v.provider, v.metadata as Record<string, unknown>)
      if (playback) {
        result[step] = playback
        break
      }
    }
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=300' } })
}
