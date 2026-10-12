import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'
import { deleteFromS3, getTeacherBucketName } from '@/lib/s3'
import { deleteMedia, getVodConfig } from '@/lib/infomaniak-vod'
import { findVideosByMediaId } from '@/lib/video-sync.server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { id } = await params

  const video = await prisma.video.findUnique({ where: { id } })
  if (!video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  // Only the uploader or an admin can delete
  if (video.uploadedById !== session.user.id && !session.user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // TODO: Mux rows still leave their asset on Mux (deleted manually after
  // the migration, see MIGRATION-VOD.md).
  await prisma.video.delete({ where: { id } })

  // Infomaniak: drop the media once no other row (page-copy duplicates share
  // it via metadata.mediaId) references it. Best effort — a failure leaves an
  // orphan on Infomaniak, not a broken page.
  const meta = (video.metadata ?? {}) as Record<string, unknown>
  if (video.provider === 'infomaniak') {
    try {
      if (typeof meta.uploadKey === 'string') {
        await deleteFromS3(meta.uploadKey, getTeacherBucketName())
      }
      const mediaId = typeof meta.mediaId === 'string' ? meta.mediaId : null
      const config = getVodConfig()
      if (mediaId && config && (await findVideosByMediaId(mediaId)).length === 0) {
        await deleteMedia(config, mediaId)
      }
    } catch (error) {
      console.warn('Video delete: provider cleanup failed:', error instanceof Error ? error.message : error)
    }
  }
  // A video is M2M with skripts, so drop every skript's file cache.
  invalidateSkriptFiles()

  return NextResponse.json({ ok: true })
}
