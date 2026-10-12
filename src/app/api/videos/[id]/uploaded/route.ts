import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { startInfomaniakImport } from '@/lib/video-sync.server'

/**
 * POST /api/videos/[id]/uploaded — step 2 of a video upload: the browser has
 * PUT the file into S3; hand it to Infomaniak VOD. Idempotent (a second call
 * returns the existing media id). Only the uploader may call it.
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
  if (!video || video.uploadedById !== session.user.id || video.provider !== 'infomaniak') {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  try {
    const metadata = await startInfomaniakImport(id)
    return NextResponse.json({ status: metadata.status })
  } catch (error) {
    console.error('Video import start failed:', error instanceof Error ? error.message : error)
    await prisma.video
      .update({ where: { id }, data: { metadata: { status: 'errored', error: 'Import failed' } } })
      .catch(() => {})
    return NextResponse.json({ error: 'Could not start video processing' }, { status: 502 })
  }
}
