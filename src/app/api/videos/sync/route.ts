import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { syncInfomaniakVideo } from '@/lib/video-sync.server'

const MAX_IDS = 20

/**
 * POST /api/videos/sync { ids: string[] } — pull the Infomaniak state for
 * unfinished videos. Called by the dashboard video browser while it polls
 * (src/components/dashboard/video-browser.tsx); the fallback for callbacks
 * that never arrive (always the case on localhost). Restricted to videos the
 * caller uploaded or co-authors a skript of.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, MAX_IDS)
    : []
  if (ids.length === 0) return NextResponse.json({ videos: {} })

  const rows = await prisma.video.findMany({
    where: {
      id: { in: ids },
      provider: 'infomaniak',
      OR: [{ uploadedById: userId }, { skripts: { some: { authors: { some: { userId } } } } }],
    },
    select: { id: true },
  })

  const videos: Record<string, unknown> = {}
  for (const { id } of rows) {
    try {
      const meta = await syncInfomaniakVideo(id)
      videos[id] = { status: meta?.status, captionsStatus: meta?.captionsStatus }
    } catch (error) {
      console.error('Video sync failed:', id, error instanceof Error ? error.message : error)
      videos[id] = { error: 'sync failed' }
    }
  }
  return NextResponse.json({ videos })
}
