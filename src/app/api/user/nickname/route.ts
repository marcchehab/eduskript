/**
 * POST /api/user/nickname
 *
 * Student-only endpoint backing the welcome modal. Updates `User.name`. Does
 * not touch any other profile field — teachers use /api/user/profile for the
 * full profile editor in the dashboard.
 *
 * Validation:
 *  - Trim whitespace.
 *  - Length 3–32 after trim.
 *  - Reject control characters (anything below 0x20 or DEL).
 *  - Empty after trim → 400.
 *
 * Auth: signed-in students only. Teachers get 403.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { nicknameSchema } from '@/lib/nickname'
import { notifyNicknameChange } from '@/lib/plugin-share.server'

const bodySchema = z.object({ name: nicknameSchema })

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.accountType !== 'student') {
    return NextResponse.json({ error: 'Students only' }, { status: 403 })
  }

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid nickname'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { name } = parsed.data

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name },
  })
  await notifyNicknameChange(session.user.id)

  return NextResponse.json({ name })
}
