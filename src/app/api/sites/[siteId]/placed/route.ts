/**
 * POST /api/sites/[siteId]/placed  body: { itemIds: string[] }
 * → { placed: string[] } — the subset of user_data item ids (pages, front
 * pages, skripts, non-content ids) that may live on this site
 * (isItemPlacedOnSite, src/lib/site-access.ts).
 *
 * Used by the sync engine to adopt pre-site-scoping local rows that were never
 * synced into the current site and push them (bughunt #12). Only reveals
 * placement, which the public site already shows; capped at 200 ids.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isItemPlacedOnSite } from '@/lib/site-access'

const MAX = 200

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params
  const body = await request.json().catch(() => ({}))
  const itemIds: unknown = body?.itemIds
  if (!Array.isArray(itemIds) || itemIds.length > MAX || !itemIds.every((i) => typeof i === 'string')) {
    return NextResponse.json({ error: `itemIds must be an array of at most ${MAX} strings` }, { status: 400 })
  }
  const unique = [...new Set(itemIds as string[])]
  const checks = await Promise.all(unique.map(async (id) => [id, await isItemPlacedOnSite(id, siteId)] as const))
  return NextResponse.json({ placed: checks.filter(([, ok]) => ok).map(([id]) => id) })
}
