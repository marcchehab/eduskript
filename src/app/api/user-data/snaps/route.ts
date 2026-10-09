/**
 * User Snaps API
 *
 * GET /api/user-data/snaps
 * Fetches all of the current user's OWN snaps across all pages and sites, with
 * page metadata. Site scoping (bughunt #5): every row belongs to one site, so
 * each snap carries its siteId/target and links to the page on THAT site.
 * Rows with no site ('' — skript placed nowhere at migration time) are not
 * listed: they render nowhere and can't be edited through the site-scoped API.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { SnapsData, SnapData } from '@/lib/userdata/adapters'

export interface SnapWithPageInfo extends SnapData {
  pageId: string
  pageTitle: string
  pageSlug: string
  skriptTitle: string
  skriptSlug: string
  collectionTitle: string | null
  /** Path prefix of the site the snap was made on ("<slug>" or "org/<slug>/c"). */
  authorPageSlug: string | null
  siteId: string
  targetType: string | null
  targetId: string | null
  createdAt: number
}

export interface AllSnapsResponse {
  snaps: SnapWithPageInfo[]
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const snapEntries = await prisma.userData.findMany({
      where: { userId, adapter: 'snaps', siteId: { not: '' } },
      select: { itemId: true, data: true, createdAt: true, siteId: true, targetType: true, targetId: true },
    })

    if (snapEntries.length === 0) {
      return NextResponse.json({ snaps: [] })
    }

    const pageIds = [...new Set(snapEntries.map((entry) => entry.itemId))]
    const siteIds = [...new Set(snapEntries.map((entry) => entry.siteId))]

    const [pages, sites] = await Promise.all([
      prisma.page.findMany({
        where: { id: { in: pageIds } },
        select: {
          id: true,
          title: true,
          slug: true,
          skript: {
            select: {
              title: true,
              slug: true,
              collectionSkripts: {
                take: 1,
                select: { collection: { select: { title: true } } },
              },
            },
          },
        },
      }),
      prisma.site.findMany({
        where: { id: { in: siteIds } },
        select: { id: true, slug: true, organizationId: true },
      }),
    ])

    const pageInfoMap = new Map(pages.map((page) => [page.id, page]))
    const siteMap = new Map(sites.map((s) => [s.id, s]))

    const snapsWithInfo: SnapWithPageInfo[] = []

    for (const entry of snapEntries) {
      const pageInfo = pageInfoMap.get(entry.itemId)
      if (!pageInfo) continue // Page was deleted

      const snapsData = entry.data as unknown as SnapsData
      if (!snapsData?.snaps || snapsData.snaps.length === 0) continue

      const site = siteMap.get(entry.siteId)
      const authorPageSlug = site ? (site.organizationId ? `org/${site.slug}/c` : site.slug) : null

      for (const snap of snapsData.snaps) {
        snapsWithInfo.push({
          ...snap,
          pageId: entry.itemId,
          pageTitle: pageInfo.title,
          pageSlug: pageInfo.slug,
          skriptTitle: pageInfo.skript.title,
          skriptSlug: pageInfo.skript.slug,
          collectionTitle: pageInfo.skript.collectionSkripts[0]?.collection?.title || null,
          authorPageSlug,
          siteId: entry.siteId,
          targetType: entry.targetType,
          targetId: entry.targetId,
          createdAt: entry.createdAt.getTime(),
        })
      }
    }

    snapsWithInfo.sort((a, b) => b.createdAt - a.createdAt)

    return NextResponse.json({ snaps: snapsWithInfo })
  } catch (error) {
    console.error('[user-data/snaps] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
