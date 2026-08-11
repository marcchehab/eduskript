import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { getSkriptFiles } from '@/lib/skript-files.server'

/**
 * GET /api/skripts/[id]/files
 *
 * Lists a skript's attachments and videos with direct download URLs, for the
 * client-side export flow (src/lib/skript-export-client.ts) — the browser
 * fetches file bytes straight from S3/Mux, no server-side buffering.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const skript = await prisma.skript.findUnique({
    where: { id },
    include: { authors: { include: { user: true } } }
  })
  if (!skript) {
    return NextResponse.json({ error: 'Skript not found' }, { status: 404 })
  }

  const permissions = checkSkriptPermissions(session.user.id, skript.authors, session.user.isAdmin)
  if (!permissions.canView) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { files, videos } = await getSkriptFiles(id)
  const videoList = Object.values(videos)

  const muxAssets = videoList.length
    ? await prisma.video.findMany({
        where: { id: { in: videoList.map(v => v.id) } },
        select: { id: true, muxAssetId: true }
      })
    : []
  const muxAssetById = new Map(muxAssets.map(v => [v.id, v.muxAssetId]))

  return NextResponse.json({
    files: Object.values(files),
    videos: videoList.map(v => ({
      id: v.id,
      filename: v.filename,
      playbackId: v.metadata.playbackId,
      muxAssetId: muxAssetById.get(v.id) ?? null
    }))
  })
}
