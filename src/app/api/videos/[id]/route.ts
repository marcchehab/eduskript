import { after, NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateSkriptFiles } from '@/lib/skript-files.server'
import { cleanupDeletedVideo } from '@/lib/video-jobs.server'

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

  await prisma.video.delete({ where: { id } })

  // Self-hosted: drop job, encoded outputs and original once no other row
  // (page copies, rows of one migrated legacy video) uses the job.
  // After the response: Swift's bulk delete takes ~0.3 s per object, so a
  // long video's ~500 segments would otherwise hold the request for minutes.
  if (video.provider === 'self') {
    const meta = (video.metadata ?? {}) as Record<string, unknown>
    after(() => cleanupDeletedVideo(video.encodeJobId, meta))
  }
  // A video is M2M with skripts, so drop every skript's file cache.
  invalidateSkriptFiles()

  return NextResponse.json({ ok: true })
}
