import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { sanitizeVisitSource } from '@/lib/visit-source'

// Only accounts this young get a source attached — the browser holds the
// source for 30 days, so an older account logging in on a newly-referred
// browser must not be relabelled.
const MAX_ACCOUNT_AGE_MS = 48 * 60 * 60 * 1000

/**
 * POST /api/user/signup-source
 *
 * Attaches the browser's first-touch visit source to the current account,
 * once. Sent by src/components/signup-attribution.tsx after login.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const source = sanitizeVisitSource(await request.json().catch(() => null))
  if (!source) return new NextResponse(null, { status: 204 })

  await prisma.user.updateMany({
    where: {
      id: session.user.id,
      signupSource: { equals: Prisma.DbNull },
      createdAt: { gte: new Date(Date.now() - MAX_ACCOUNT_AGE_MS) },
    },
    data: { signupSource: source as object },
  })

  return new NextResponse(null, { status: 204 })
}
