/**
 * DELETE /api/mail-hooks/[token] — delete one of the caller's hooks (cascades
 * its messages). Owner-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token } = await params
  const hook = await prisma.mailHook.findUnique({ where: { token } })
  if (!hook || hook.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.mailHook.delete({ where: { id: hook.id } })
  return NextResponse.json({ success: true })
}
