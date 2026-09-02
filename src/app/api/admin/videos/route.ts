import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
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
  if (aspectRatio) {
    // Accept both Mux's "16:9" format and a plain decimal like "1.778".
    const ratio = String(aspectRatio).includes(':')
      ? (() => {
          const [w, h] = String(aspectRatio).split(':').map(Number)
          return w && h ? w / h : NaN
        })()
      : Number(aspectRatio)
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return NextResponse.json(
        { error: 'aspectRatio must be a number (e.g. 1.778) or W:H (e.g. 16:9)' },
        { status: 400 }
      )
    }
    metadata.aspectRatio = ratio
  }

  // Mux generates poster/thumbnail URLs from playbackId
  metadata.poster = `https://image.mux.com/${playbackId}/thumbnail.webp?time=0`

  try {
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
  } catch (e) {
    // Unique on [filename, provider, uploadedById] — e.g. the Mux webhook
    // already registered this video at upload time.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json(
        { error: `A video named "${filename.trim()}" already exists for your account` },
        { status: 409 }
      )
    }
    console.error('POST /api/admin/videos failed:', e)
    return NextResponse.json({ error: 'Failed to add video' }, { status: 500 })
  }
}
