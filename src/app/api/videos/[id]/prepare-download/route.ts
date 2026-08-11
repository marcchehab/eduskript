import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Mux from '@mux/mux-node'

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID!,
  tokenSecret: process.env.MUX_TOKEN_SECRET!,
})

/**
 * POST /api/videos/[id]/prepare-download
 *
 * Mux assets only serve HLS streaming by default — there's no downloadable
 * original file. This enables (or checks progress of) a static MP4
 * rendition, so the export flow (src/lib/skript-export-client.ts) can fetch
 * the resulting public https://stream.mux.com/{playbackId}/{name} URL
 * directly from the browser. Static renditions take real processing time
 * (seconds to a couple of minutes), so the client polls this route.
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

  if (!video.muxAssetId) {
    return NextResponse.json({ status: 'error', error: 'Video is not ready on Mux yet' })
  }

  const metadata = video.metadata as Record<string, unknown>
  const playbackId = metadata?.playbackId as string | undefined
  if (!playbackId) {
    return NextResponse.json({ status: 'error', error: 'Video has no playback ID' })
  }

  const asset = await mux.video.assets.retrieve(video.muxAssetId)
  const renditions = asset.static_renditions?.files ?? []
  const highest = renditions.find(f => f.name?.startsWith('highest'))

  if (!highest) {
    // Not requested yet — kick it off, client polls again shortly.
    await mux.video.assets.createStaticRendition(video.muxAssetId, { resolution: 'highest' })
    return NextResponse.json({ status: 'preparing' })
  }

  if (highest.status === 'ready') {
    return NextResponse.json({
      status: 'ready',
      url: `https://stream.mux.com/${playbackId}/${highest.name}`
    })
  }

  if (highest.status === 'errored') {
    return NextResponse.json({ status: 'error', error: 'Mux failed to prepare the download' })
  }

  return NextResponse.json({ status: 'preparing' })
}
