import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MAX_RESULTS = 50

/**
 * GET /api/files/search?q=<query>&excludeSkriptId=<id>
 *
 * Search files across all skripts where the current user has author rights.
 * Used by the cross-skript file import dialog so a teacher can find a file
 * they uploaded into one skript and reuse it in another (deduplicated via
 * the existing content-addressed `hash` field — no S3 re-upload).
 *
 * Query params:
 *   q                  case-insensitive substring on filename. Empty/missing
 *                      returns the most recently updated files.
 *   excludeSkriptId    omit files from this skript (the current skript — there
 *                      is no point importing into the same skript)
 *
 * Returns at most 50 rows ordered by `updatedAt DESC`. No pagination — this is
 * an assistive picker, not a file manager.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  const excludeSkriptId = searchParams.get('excludeSkriptId') ?? undefined

  const files = await prisma.file.findMany({
    where: {
      isDirectory: false,
      hash: { not: null },
      ...(excludeSkriptId ? { skriptId: { not: excludeSkriptId } } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      skript: {
        authors: {
          some: {
            userId: session.user.id,
            permission: 'author',
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      hash: true,
      contentType: true,
      size: true,
      skriptId: true,
      skript: { select: { title: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: MAX_RESULTS,
  })

  return NextResponse.json({
    files: files.map(f => ({
      id: f.id,
      name: f.name,
      hash: f.hash!,
      contentType: f.contentType,
      size: f.size != null ? Number(f.size) : null,
      sourceSkriptId: f.skriptId,
      sourceSkriptTitle: f.skript.title,
    })),
  })
}
