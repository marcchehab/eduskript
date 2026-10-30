/**
 * GET/PATCH /api/user/product-updates — the account-settings toggle.
 * PATCH { enabled: boolean }. Teachers only (students get no product mail).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { setProductUpdates } from '@/lib/product-updates/service'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { productUpdates: true },
  })
  return NextResponse.json({ enabled: user?.productUpdates ?? false })
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.user.accountType === 'student') {
    return NextResponse.json({ error: 'Teachers only' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }
  await setProductUpdates(session.user.id, body.enabled)
  return NextResponse.json({ enabled: body.enabled })
}
