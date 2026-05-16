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

const bodySchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(3, 'Nickname must be at least 3 characters')
        .max(32, 'Nickname must be 32 characters or fewer')
        .regex(/^[^\x00-\x1f\x7f]+$/, 'Nickname cannot contain control characters'),
    ),
})

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

  return NextResponse.json({ name })
}
