import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MAX_RESULTS = 50

/**
 * GET /api/videos/search?q=<query>&excludeSkriptId=<id>
 *
 * Search Mux videos the current user can reuse — videos they uploaded, or
 * videos linked (via SkriptVideos) to a skript they author. Backs the
 * cross-skript video import dialog: linking a video to another skript is
 * just a join-table row, since the Mux asset itself is shared (cf.
 * /api/files/search, the file equivalent).
 *
 *   q                case-insensitive substring on filename. Empty/missing
 *                    returns the most-recently-updated videos.
 *   excludeSkriptId  omit videos already linked to this skript (the current
 *                    one — importing into the same skript is a no-op)
 *
 * Returns at most 50 rows ordered by `updatedAt DESC`. No pagination — this
 * is an assistive picker, not a media manager.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  const excludeSkriptId = searchParams.get('excludeSkriptId') ?? undefined

  const videos = await prisma.video.findMany({
    where: {
      // Reusable = you uploaded it, or it's linked to a skript you author.
      OR: [
        { uploadedById: userId },
        { skripts: { some: { authors: { some: { userId, permission: 'author' } } } } },
      ],
      ...(excludeSkriptId ? { skripts: { none: { id: excludeSkriptId } } } : {}),
      ...(q ? { filename: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    select: {
      id: true,
      filename: true,
      provider: true,
      metadata: true,
      // The skripts this video already lives in — shown as context so the
      // teacher recognises which video they're reaching for.
      skripts: { select: { title: true }, orderBy: { updatedAt: 'desc' } },
    },
    orderBy: { updatedAt: 'desc' },
    take: MAX_RESULTS,
  })

  return NextResponse.json({
    videos: videos.map(v => {
      const metadata = v.metadata as Record<string, unknown> | null
      return {
        id: v.id,
        filename: v.filename,
        provider: v.provider,
        poster: (metadata?.poster as string | undefined) ?? null,
        status: (metadata?.status as string | undefined) ?? 'ready',
        skriptTitles: v.skripts.map(s => s.title),
      }
    }),
  })
}
