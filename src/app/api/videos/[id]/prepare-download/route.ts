import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/videos/[id]/prepare-download
 *
 * Returns the 720p download MP4 the encoder wrote to S3 (metadata.mp4Url,
 * public, CORS *) once the video is ready; 'preparing' while it encodes (the
 * export flow in src/lib/skript-export-client.ts polls). Legacy provider
 * 'mux' rows have no download.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const userId = session.user.id

  const video = await prisma.video.findFirst({
    where: {
      id,
      OR: [
        { uploadedById: userId },
        { skripts: { some: { authors: { some: { userId } } } } }
      ]
    }
  })
  if (!video) {
    return NextResponse.json({ error: 'Video not found or access denied' }, { status: 404 })
  }

  if (video.provider !== 'self') {
    return NextResponse.json({ status: 'error', error: 'Video is unavailable' })
  }
  const meta = video.metadata as Record<string, unknown>
  if (meta?.status !== 'ready') {
    return NextResponse.json({ status: 'preparing' })
  }
  if (typeof meta.mp4Url !== 'string') {
    return NextResponse.json({ status: 'error', error: 'Video has no downloadable rendition' })
  }
  return NextResponse.json({ status: 'ready', url: meta.mp4Url })
}
