/**
 * User Data Manifest API
 *
 * GET /api/user-data/manifest
 * Returns a list of all user data items with their versions and timestamps.
 * Used by the client to determine what needs to be synced.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getItemIdsForSite } from '@/lib/site-pages'

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

    // Scope to the requesting site when known — each custom domain / org route
    // is its own browser origin with its own empty IndexedDB, so an unscoped
    // manifest pulls in every UserData row across every site the teacher owns
    // (thousands for an active user) even though this origin only ever needs
    // the current site's. siteId is optional: dashboard/account-wide callers
    // omit it and get the full account manifest, as before.
    const siteId = request.nextUrl.searchParams.get('siteId')
    const itemIdFilter = siteId ? await getItemIdsForSite(siteId) : null

    const items = await prisma.userData.findMany({
      where: {
        userId,
        ...(itemIdFilter ? { itemId: { in: itemIdFilter } } : {}),
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
