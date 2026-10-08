/**
 * GET /api/sites/[siteId]/access — the signed-in viewer's presentation-data
 * rights on a site (src/lib/site-access.ts). Lets ISR-rendered public pages
 * gate the class/site toolbar and the public-layer editor client-side without
 * reading the session server-side.
 *
 * Response: { canManage, isOwner, kind } — all false for anonymous viewers
 * and students. 404 for an unknown site.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSiteAccess } from '@/lib/site-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params
  const session = await getServerSession(authOptions)
  const access = await getSiteAccess(session?.user?.id, siteId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(
    { canManage: access.canManage, isOwner: access.isOwner, kind: access.kind },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
