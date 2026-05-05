/**
 * User Data Bulk Fetch API
 *
 * POST /api/user-data/bulk-fetch
 * Body: { items: [{ adapter, itemId }] }
 *
 * Returns matching personal records in a single round trip. Used by
 * sync-engine.initialSync to avoid N+1 GETs against /[adapter]/[itemId]
 * when reconciling the server manifest with local IndexedDB.
 *
 * Personal data only — no targeting (class/student/page). Targeted data
 * is fetched via the per-item endpoint where authorization can be checked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface BulkFetchRequest {
  items: Array<{ adapter: string; itemId: string }>
}

interface BulkFetchItem {
  adapter: string
  itemId: string
  data: unknown
  version: number
  updatedAt: number
}

const MAX_ITEMS = 500

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = (await request.json()) as BulkFetchRequest
    const requested = body.items
    if (!Array.isArray(requested)) {
      return NextResponse.json({ error: 'items must be an array' }, { status: 400 })
    }
    if (requested.length === 0) {
      return NextResponse.json({ items: [] })
    }
    if (requested.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `Too many items (max ${MAX_ITEMS})` },
        { status: 400 }
      )
    }

    // Group by adapter so we can issue one query per adapter instead of one
    // monster OR with N pairs. UserData has @@index([userId, adapter]), so
    // (userId, adapter, itemId IN [...]) is well served by the index.
    const byAdapter = new Map<string, Set<string>>()
    for (const it of requested) {
      if (!it?.adapter || !it?.itemId) continue
      const set = byAdapter.get(it.adapter) ?? new Set<string>()
      set.add(it.itemId)
      byAdapter.set(it.adapter, set)
    }

    const items: BulkFetchItem[] = []
    for (const [adapter, itemIds] of byAdapter.entries()) {
      const rows = await prisma.userData.findMany({
        where: {
          userId,
          adapter,
          itemId: { in: Array.from(itemIds) },
          targetType: null,
          targetId: null,
        },
        select: {
          adapter: true,
          itemId: true,
          data: true,
          version: true,
          updatedAt: true,
        },
      })
      for (const row of rows) {
        items.push({
          adapter: row.adapter,
          itemId: row.itemId,
          data: row.data,
          version: row.version,
          updatedAt: row.updatedAt.getTime(),
        })
      }
    }

    return NextResponse.json({ items })
  } catch (error) {
    console.error('[user-data/bulk-fetch] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
