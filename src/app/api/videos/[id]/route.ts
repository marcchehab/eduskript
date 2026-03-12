import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

  // TODO: Also delete the asset on Mux (via Mux API) to avoid orphaned assets and billing.
  // For now this only removes the database entry.
  await prisma.video.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
