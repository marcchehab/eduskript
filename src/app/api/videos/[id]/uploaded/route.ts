import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enqueueUploadedVideo } from '@/lib/video-jobs.server'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

/**
 * POST /api/videos/[id]/uploaded — step 2 of a video upload: the browser has
 * PUT the file into S3; queue the encode for scripts/video-worker.mjs.
 * Idempotent. Only the uploader may call it.
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
  const video = await prisma.video.findUnique({ where: { id }, select: { uploadedById: true, provider: true } })
  if (!video || video.uploadedById !== session.user.id || video.provider !== 'self') {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  try {
    const metadata = await enqueueUploadedVideo(id)
    invalidateSkriptFiles()
    return NextResponse.json({ status: metadata.status })
  } catch (error) {
    console.error('Video enqueue failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not queue the video for processing' }, { status: 500 })
  }
}
