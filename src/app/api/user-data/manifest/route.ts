/**
 * User Data Manifest API
 *
 * GET /api/user-data/manifest?siteId=…
 * Returns the caller's personal user data items ON ONE SITE with their
 * versions and timestamps. Used by the client to determine what needs to be
 * synced. siteId is required: data is site-scoped (src/lib/site-access.ts),
 * there is no account-wide manifest anymore.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface ManifestItem {
  adapter: string
  itemId: string
  version: number
  updatedAt: number
}

export async function GET(request: NextRequest) {
  try {
    // NextAuth first, then the SEB exam_session cookie (cookie holds the random
    // `sessionId`, not the row PK). Without the exam-session fallback the sync
    // engine's manifest fetch 401s for SEB students and can't reconcile.
    let userId: string | null = null
    const session = await getServerSession(authOptions)
    if (session?.user?.id) {
      userId = session.user.id
    } else {
      const examSessionCookie = (await cookies()).get('exam_session')?.value
      if (examSessionCookie) {
        const examSession = await prisma.examSession.findUnique({
          where: { sessionId: examSessionCookie },
          select: { userId: true, expiresAt: true },
        })
        if (examSession && new Date(examSession.expiresAt) > new Date()) {
          userId = examSession.userId
        }
      }
    }
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Rows carry their site, so the filter is a plain column match. Personal
    // rows only — targeted rows (broadcasts/public layer) are loaded per item
    // by the client, where authorization is checked.
    const siteId = request.nextUrl.searchParams.get('siteId')
    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }

    const items = await prisma.userData.findMany({
      where: {
        userId,
        siteId,
        targetType: null,
        targetId: null,
      },
      select: {
        adapter: true,
        itemId: true,
        version: true,
        updatedAt: true,
      },
    })

    const manifest: ManifestItem[] = items.map((item) => ({
      adapter: item.adapter,
      itemId: item.itemId,
      version: item.version,
      updatedAt: item.updatedAt.getTime(),
    }))

    return NextResponse.json(manifest)
  } catch (error) {
    console.error('[user-data/manifest] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
