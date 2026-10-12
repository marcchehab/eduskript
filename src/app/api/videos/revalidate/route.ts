import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

/**
 * POST /api/videos/revalidate { videoIds?: string[] } — called by the video
 * encoder (scripts/video-worker.mjs) after each job. The worker writes the
 * DB directly, which the skript-files and page caches can't see; this drops
 * them. Auth: Bearer CRON_SECRET (shared by both roles).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization') ?? ''
  const provided = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(secret ?? '')
  if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body?.videoIds)
    ? (body.videoIds as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 500)
    : []
  const skripts = ids.length
    ? await prisma.skript.findMany({ where: { videos: { some: { id: { in: ids } } } }, select: { id: true } })
    : []
  invalidateSkriptFiles()
  for (const s of skripts) invalidateSkriptFiles(s.id)
  return NextResponse.json({ ok: true, skripts: skripts.length })
}
