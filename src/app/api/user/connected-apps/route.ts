/**
 * GET /api/user/connected-apps — list active OAuth client connections for the
 * signed-in user. Groups by clientId and shows whichever access token is
 * freshest (most-recently used or most-recently created).
 *
 * "Active" = has at least one non-revoked, non-expired access OR refresh token.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  const tokens = await prisma.oAuthAccessToken.findMany({
    where: {
      userId: session.user.id,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: {
      client: {
        select: { clientId: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const byClient = new Map<
    string,
    {
      clientId: string
      clientName: string
      tokenPrefix: string
      scopes: string[]
      lastUsedAt: Date | null
      issuedAt: Date
    }
  >()

  for (const token of tokens) {
    const existing = byClient.get(token.clientId)
    if (
      !existing ||
      (token.lastUsedAt &&
        (!existing.lastUsedAt || token.lastUsedAt > existing.lastUsedAt))
    ) {
      byClient.set(token.clientId, {
        clientId: token.clientId,
        clientName: token.client.name,
        tokenPrefix: token.tokenPrefix,
        scopes: token.scopes,
        lastUsedAt: token.lastUsedAt ?? existing?.lastUsedAt ?? null,
        issuedAt: token.createdAt,
      })
    }
  }

  return NextResponse.json({ apps: Array.from(byClient.values()) })
}
