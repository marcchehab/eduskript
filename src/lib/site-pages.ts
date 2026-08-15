/**
 * All UserData-bearing item ids for a given site — used to scope the sync
 * engine's manifest/bulk-fetch to "what this site actually needs" instead
 * of a teacher's entire account (see src/lib/userdata/sync-engine.ts).
 *
 * Covers, unfiltered by publish status (sync must cover drafts too — a
 * teacher's own scratch code-editor content on an unpublished page is still
 * real UserData):
 *   - Page ids under root skripts (PageLayoutItem type='skript')
 *   - Page ids under skripts nested in the site's Collections
 *   - The site's own FrontPage id (org/teacher landing page)
 *   - Each of the site's skripts' own FrontPage id
 */

import { prisma } from '@/lib/prisma'

export async function getItemIdsForSite(siteId: string): Promise<string[]> {
  const [pageLayout, collections, siteFrontPage] = await Promise.all([
    prisma.pageLayout.findUnique({
      where: { siteId },
      select: { items: { where: { type: 'skript' }, select: { contentId: true } } },
    }),
    prisma.collection.findMany({
      where: { siteId },
      select: { collectionSkripts: { select: { skriptId: true } } },
    }),
    prisma.frontPage.findUnique({ where: { siteId }, select: { id: true } }),
  ])

  const skriptIds = new Set<string>()
  for (const item of pageLayout?.items ?? []) skriptIds.add(item.contentId)
  for (const collection of collections) {
    for (const cs of collection.collectionSkripts) skriptIds.add(cs.skriptId)
  }

  if (skriptIds.size === 0) {
    return siteFrontPage ? [siteFrontPage.id] : []
  }

  const [pages, skriptFrontPages] = await Promise.all([
    prisma.page.findMany({ where: { skriptId: { in: Array.from(skriptIds) } }, select: { id: true } }),
    prisma.frontPage.findMany({ where: { skriptId: { in: Array.from(skriptIds) } }, select: { id: true } }),
  ])

  const itemIds = pages.map(p => p.id).concat(skriptFrontPages.map(fp => fp.id))
  if (siteFrontPage) itemIds.push(siteFrontPage.id)
  return itemIds
}
