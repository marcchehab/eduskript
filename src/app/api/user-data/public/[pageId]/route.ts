/**
 * Public layers fetch
 *
 * GET /api/user-data/public/[pageId]
 *
 * Returns every public (page-broadcast) layer for a page — annotations, snaps,
 * sticky notes — in one round-trip. Mirrors getPublicLayers() in
 * src/lib/public-page-data.ts; this is the client-side recovery path for anon
 * and non-author viewers when the SSR/ISR seed is stale.
 *
 * Why this exists: ISR (`revalidate = false`) on /[domain]/.../[pageSlug] +
 * Koyeb's multi-instance deploy means revalidatePath only clears the cache on
 * the instance that received the write. A sibling instance can serve stale
 * empty SSR indefinitely, so client layers refresh from this endpoint on
 * mount and on visibilitychange/focus.
 *
 * Multi-author note: annotations and snaps are findMany (one row per author);
 * /api/user-data/[adapter]/[itemId]?targetType=page only returns findFirst,
 * which would silently drop co-authors' public layers.
 *
 * No auth: public layers are visible to everyone by design.
 */

import { NextResponse } from 'next/server'
import { getPublicLayers } from '@/lib/public-page-data'

interface RouteParams {
  params: Promise<{ pageId: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { pageId } = await params
    const decodedPageId = decodeURIComponent(pageId)
    const layers = await getPublicLayers(decodedPageId)
    return NextResponse.json(layers)
  } catch (error) {
    console.error('[user-data/public] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
