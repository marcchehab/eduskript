/**
 * User Snaps API
 *
 * GET /api/user-data/snaps
 * Fetches all snaps for the current user across all pages, with page metadata.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import type { SnapsData, SnapData } from '@/lib/userdata/adapters'

export interface SnapWithPageInfo extends SnapData {
  pageId: string
  pageTitle: string
  pageSlug: string
  skriptTitle: string
  skriptSlug: string
  collectionTitle: string | null
  authorPageSlug: string | null
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

    // Get all snap data for this user
    const snapEntries = await prisma.userData.findMany({
      where: {
        userId,
        adapter: 'snaps',
      },
      select: {
        itemId: true, // This is the pageId
        data: true,
        createdAt: true,
      },
    })

    if (snapEntries.length === 0) {
      return NextResponse.json({ snaps: [] })
    }

    // Get all page IDs
    const pageIds = snapEntries.map((entry) => entry.itemId)

    // Fetch page info with relations
    const pages = await prisma.page.findMany({
      where: {
        id: { in: pageIds },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        skript: {
          select: {
            id: true,
            title: true,
            slug: true,
            collectionSkripts: {
              take: 1, // Just get one collection (for URL building)
              select: {
                collection: {
                  select: {
                    title: true,
                    site: { select: { slug: true } },
                  },
                },
              },
            },
            // Fallback: a skript author's site provides the URL when the
            // skript isn't placed in any collection.
            authors: {
              where: { permission: 'author' },
              take: 1,
              select: {
                user: {
                  select: {
                    sites: { select: { slug: true }, orderBy: PRIMARY_SITE_ORDER, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
    })

    // Create a map of pageId -> page info
    const pageInfoMap = new Map(pages.map((page) => [page.id, page]))

    // Build the response with snaps and their page info
    const snapsWithInfo: SnapWithPageInfo[] = []

    for (const entry of snapEntries) {
      const pageInfo = pageInfoMap.get(entry.itemId)
      if (!pageInfo) continue // Page was deleted

      const snapsData = entry.data as unknown as SnapsData
      if (!snapsData?.snaps || snapsData.snaps.length === 0) continue

      // Get collection info
      const collectionSkript = pageInfo.skript.collectionSkripts[0]
      const collection = collectionSkript?.collection

      // Author page slug: prefer the collection's owning Site; fall back to
      // a skript author's own Site for collection-less skripts.
      const authorPageSlug =
        collection?.site?.slug ||
        pageInfo.skript.authors[0]?.user?.sites[0]?.slug ||
        null

      // Add each snap with page info
      for (const snap of snapsData.snaps) {
        snapsWithInfo.push({
          ...snap,
          pageId: entry.itemId,
          pageTitle: pageInfo.title,
          pageSlug: pageInfo.slug,
          skriptTitle: pageInfo.skript.title,
          skriptSlug: pageInfo.skript.slug,
          collectionTitle: collection?.title || null,
          authorPageSlug,
          createdAt: entry.createdAt.getTime(),
        })
      }
    }

    // Sort by createdAt (newest first)
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
