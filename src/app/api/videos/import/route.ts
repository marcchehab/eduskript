import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/videos/import
 * Body: { sourceVideoId: string, targetSkriptId: string }
 *
 * Cross-skript video import: links an existing Video to another skript via
 * the SkriptVideos join table. No Mux re-upload — the asset is shared, so
 * this is purely a join-table row (cf. /api/files/import, which clones a
 * File row that points at the same content-addressed S3 object).
 *
 * Permission rules:
 *   - The video must be reusable by the user: they uploaded it, or it's
 *     linked to a skript they author.
 *   - The user must have author rights on the target skript.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { sourceVideoId?: unknown; targetSkriptId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sourceVideoId, targetSkriptId } = body
  if (typeof sourceVideoId !== 'string' || typeof targetSkriptId !== 'string') {
    return NextResponse.json(
      { error: 'sourceVideoId and targetSkriptId are required strings' },
      { status: 400 }
    )
  }

  const userId = session.user.id

  // Target skript must be one the user authors.
  const targetSkript = await prisma.skript.findFirst({
    where: { id: targetSkriptId, authors: { some: { userId, permission: 'author' } } },
    select: { id: true },
  })
  if (!targetSkript) {
    return NextResponse.json(
      { error: 'You need author rights on the target skript' },
      { status: 403 }
    )
  }

  // Video must be reusable by the user — same filter the search endpoint uses.
  // `skripts` is narrowed to the target so we can detect an existing link.
  const video = await prisma.video.findFirst({
    where: {
      id: sourceVideoId,
      OR: [
        { uploadedById: userId },
        { skripts: { some: { authors: { some: { userId, permission: 'author' } } } } },
      ],
    },
    select: {
      id: true,
      filename: true,
      provider: true,
      metadata: true,
      skripts: { where: { id: targetSkriptId }, select: { id: true } },
    },
  })
  if (!video) {
    return NextResponse.json(
      { error: 'Video not found or not accessible' },
      { status: 404 }
    )
  }

  // Already linked? Refuse rather than silently no-op, so the UI can say so.
  if (video.skripts.length > 0) {
    return NextResponse.json(
      { error: `"${video.filename}" is already in this skript` },
      { status: 409 }
    )
  }

  await prisma.video.update({
    where: { id: sourceVideoId },
    data: { skripts: { connect: { id: targetSkriptId } } },
  })

  const metadata = video.metadata as Record<string, unknown> | null
  return NextResponse.json({
    video: {
      id: video.id,
      filename: video.filename,
      provider: video.provider,
      poster: (metadata?.poster as string | undefined) ?? null,
      status: (metadata?.status as string | undefined) ?? 'ready',
    },
  })
}
