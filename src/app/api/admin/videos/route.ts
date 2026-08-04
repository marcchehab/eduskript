import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

export async function POST(request: NextRequest) {
  const { error, session } = await requireAdmin()
  if (error) return error

  const body = await request.json()
  const { filename, playbackId, aspectRatio } = body

  if (!filename || !playbackId) {
    return NextResponse.json(
      { error: 'filename and playbackId are required' },
      { status: 400 }
    )
  }

  // Build metadata matching the expected VideoInfo shape
  const metadata: Record<string, unknown> = { playbackId, status: 'ready' }
  if (aspectRatio) metadata.aspectRatio = Number(aspectRatio)

  // Mux generates poster/thumbnail URLs from playbackId
  metadata.poster = `https://image.mux.com/${playbackId}/thumbnail.webp?time=0`

  const video = await prisma.video.create({
    data: {
      filename: filename.trim(),
      provider: 'mux',
      metadata,
      uploadedById: session!.user.id,
    },
  })

  // No skript to name here — an admin-created video is linked later.
  invalidateSkriptFiles()

  return NextResponse.json(video, { status: 201 })
}
