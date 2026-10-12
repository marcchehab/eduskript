import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { retryVideoJob } from '@/lib/video-jobs.server'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'

/**
 * POST /api/videos/[id]/retry — requeue a failed encode (fresh attempts).
 * Uploader, co-authors of a linked skript, or admins.
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
      ...(session.user.isAdmin
        ? {}
        : { OR: [{ uploadedById: userId }, { skripts: { some: { authors: { some: { userId, permission: 'author' } } } } }] }),
    },
    select: { id: true },
  })
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  const ok = await retryVideoJob(id)
  if (!ok) return NextResponse.json({ error: 'This video is not in a failed state' }, { status: 409 })
  invalidateSkriptFiles()
  return NextResponse.json({ status: 'queued' })
}
