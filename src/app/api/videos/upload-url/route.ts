import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'
import { generatePresignedUploadUrl, getTeacherBucketName, isTeacherS3Configured } from '@/lib/s3'
import { getVodConfig } from '@/lib/infomaniak-vod'
import { newUploadKey } from '@/lib/video-sync.server'

/**
 * POST /api/videos/upload-url — step 1 of a video upload.
 *
 * Creates the Video row (provider "infomaniak", status "waiting") and returns
 * a presigned S3 PUT into the teacher bucket under video-uploads/. The client
 * then PUTs the file and calls POST /api/videos/[id]/uploaded, which hands the
 * object to Infomaniak VOD (src/lib/video-sync.server.ts).
 */

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isPaidUser(session.user)) {
      return paidOnlyResponse('Video hosting is a paid feature.')
    }

    const body = await request.json()
    const { filename, skriptId } = body

    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    const sanitizedFilename = filename.trim()
    if (!sanitizedFilename) {
      return NextResponse.json({ error: 'filename cannot be empty' }, { status: 400 })
    }

    if (skriptId !== undefined && typeof skriptId !== 'string') {
      return NextResponse.json({ error: 'skriptId must be a string' }, { status: 400 })
    }

    // If a skriptId is supplied, verify the caller has author permission on it
    // before connecting the new Video via SkriptVideos.
    if (skriptId) {
      const authorLink = await prisma.skriptAuthor.findFirst({
        where: {
          skriptId,
          userId: session.user.id,
          permission: 'author',
        },
        select: { id: true },
      })
      if (!authorLink) {
        return NextResponse.json(
          { error: 'You need edit permissions on this skript to upload a video' },
          { status: 403 }
        )
      }
    }

    if (!getVodConfig() || !isTeacherS3Configured()) {
      return NextResponse.json({ error: 'Video hosting is not configured on this server' }, { status: 503 })
    }

    const contentType =
      typeof body.contentType === 'string' && body.contentType.startsWith('video/')
        ? body.contentType
        : 'video/mp4'

    const uploadKey = newUploadKey(sanitizedFilename)
    const video = await prisma.video.create({
      data: {
        filename: sanitizedFilename,
        provider: 'infomaniak',
        metadata: { status: 'waiting', uploadKey },
        uploadedById: session.user.id,
        ...(skriptId ? { skripts: { connect: { id: skriptId } } } : {}),
      },
    })

    // 6 h: large lecture recordings on school uplinks take a while.
    const { url: uploadUrl } = await generatePresignedUploadUrl(
      uploadKey,
      contentType,
      6 * 3600,
      getTeacherBucketName()
    )

    invalidateSkriptFiles(skriptId)

    return NextResponse.json({
      uploadUrl,
      videoId: video.id,
      // The presigned URL signs Content-Type; the PUT must send exactly this.
      uploadHeaders: { 'Content-Type': contentType },
    })
  } catch (error) {
    console.error('Video upload URL error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create upload URL' },
      { status: 500 }
    )
  }
}
