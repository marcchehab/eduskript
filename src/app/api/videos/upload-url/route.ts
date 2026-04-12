import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Mux from '@mux/mux-node'

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID!,
  tokenSecret: process.env.MUX_TOKEN_SECRET!,
})

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // Create Mux direct upload with auto-generated subtitles
    const upload = await mux.video.uploads.create({
      new_asset_settings: {
        playback_policy: ['public'],
        inputs: [
          {
            generated_subtitles: [
              { language_code: 'en', name: 'English (auto)' },
            ],
          },
        ],
      },
      cors_origin: request.headers.get('origin') || '*',
    })

    // Create Video record in waiting state, linked to the originating skript.
    const video = await prisma.video.create({
      data: {
        filename: sanitizedFilename,
        provider: 'mux',
        metadata: { status: 'waiting' },
        uploadedById: session.user.id,
        muxUploadId: upload.id,
        ...(skriptId ? { skripts: { connect: { id: skriptId } } } : {}),
      },
    })

    return NextResponse.json({
      uploadUrl: upload.url,
      videoId: video.id,
    })
  } catch (error) {
    console.error('Video upload URL error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create upload URL' },
      { status: 500 }
    )
  }
}
