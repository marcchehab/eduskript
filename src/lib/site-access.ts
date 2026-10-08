/**
 * Site scoping — the ONE rule set for presentation data (see SITE-SCOPING.md).
 *
 * Content (skript/page text, tasks, rubrics, exam config) belongs to its
 * authors. Presentation belongs to the SITE it is shown on: public/class/
 * personal annotations, student answers (user_data), checkpoints, exam
 * submissions/scores/states. Every row carries a `siteId`; nothing is visible
 * outside its site.
 *
 * Who manages a site's presentation data:
 *   - personal site: the owner (Site.userId)
 *   - org site:      org members with role owner|admin
 * Deliberately NO superadmin bypass and NO authorship grant — authoring a
 * skript gives no rights on the student data of the sites that show it.
 * (Contrast canEditSite in permissions.ts, which has an isAdmin bypass and
 * governs site *configuration*, not student data.)
 *
 * Placement: a skript is placed on a site when it is
 *   (a) a root item of the site's PageLayout (type 'skript'), or
 *   (b) in a collection owned by the site (Collection.siteId), or
 *   (c) in a collection referenced by the site's PageLayout (org layouts may
 *       point at an admin's personal collection).
 * A page renders only on sites that place its skript. The data migration
 * (prisma/migrations/*_site_scoping) uses the same rule in SQL.
 *
 * Cost: each helper is 1–3 indexed queries; nothing here is cached (callers
 * are API routes that already hit the DB). Public ISR renders don't call
 * these — they resolve the site from the route and filter by siteId.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type SiteKind = 'personal' | 'org'

export interface SiteAccess {
  siteId: string
  kind: SiteKind
  /** May read all answers/submissions and write the public layer. */
  canManage: boolean
  /** Personal-site owner. Only owners get the class toolbar (classes are
   *  teacher-owned; org sites have no classes). */
  isOwner: boolean
}

const MANAGER_ROLES = ['owner', 'admin']

/** Access of `userId` on `siteId`. null when the site doesn't exist. */
export async function getSiteAccess(
  userId: string | null | undefined,
  siteId: string | null | undefined,
): Promise<SiteAccess | null> {
  if (!siteId) return null
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, userId: true, organizationId: true },
  })
  if (!site) return null
  const kind: SiteKind = site.organizationId ? 'org' : 'personal'
  if (!userId) return { siteId, kind, canManage: false, isOwner: false }

  if (kind === 'personal') {
    const isOwner = site.userId === userId
    return { siteId, kind, canManage: isOwner, isOwner }
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: site.organizationId!, userId } },
    select: { role: true },
  })
  const canManage = !!membership && MANAGER_ROLES.includes(membership.role)
  return { siteId, kind, canManage, isOwner: false }
}

/** True when `userId` manages the site's presentation data (see header). */
export async function canManageSite(
  userId: string | null | undefined,
  siteId: string | null | undefined,
): Promise<boolean> {
  return (await getSiteAccess(userId, siteId))?.canManage ?? false
}

/** Every site whose presentation data `userId` manages: own personal sites +
 *  org sites where they are owner/admin. */
export async function getManagedSiteIds(userId: string): Promise<string[]> {
  const sites = await prisma.site.findMany({
    where: {
      OR: [
        { userId },
        {
          organization: {
            members: { some: { userId, role: { in: MANAGER_ROLES } } },
          },
        },
      ],
    },
    select: { id: true },
  })
  return sites.map(s => s.id)
}

/** Personal sites `userId` owns (class-toolbar sites). */
export async function getOwnedSiteIds(userId: string): Promise<string[]> {
  const sites = await prisma.site.findMany({ where: { userId }, select: { id: true } })
  return sites.map(s => s.id)
}

/** Sites the skript is placed on (rule in the header). Unordered, deduped. */
export async function getPlacementSiteIdsForSkript(skriptId: string): Promise<string[]> {
  const [rootItems, ownedCollections] = await Promise.all([
    prisma.pageLayoutItem.findMany({
      where: { type: 'skript', contentId: skriptId },
      select: { pageLayout: { select: { siteId: true } } },
    }),
    prisma.collectionSkript.findMany({
      where: { skriptId },
      select: { collectionId: true, collection: { select: { siteId: true } } },
    }),
  ])
  const ids = new Set<string>()
  for (const i of rootItems) ids.add(i.pageLayout.siteId)
  for (const c of ownedCollections) ids.add(c.collection.siteId)

  const collectionIds = ownedCollections.map(c => c.collectionId)
  if (collectionIds.length > 0) {
    const referenced = await prisma.pageLayoutItem.findMany({
      where: { type: 'collection', contentId: { in: collectionIds } },
      select: { pageLayout: { select: { siteId: true } } },
    })
    for (const r of referenced) ids.add(r.pageLayout.siteId)
  }
  return [...ids]
}

/**
 * Prisma `where` fragment (spread into a SkriptWhereInput) matching skripts
 * placed on `siteId`. One query to read the site's layout items, then the
 * fragment is a plain OR the caller's query evaluates. Contains an `OR` key,
 * so don't spread it next to another top-level OR.
 */
export async function placedOnSiteWhere(siteId: string): Promise<Prisma.SkriptWhereInput> {
  const layout = await prisma.pageLayout.findUnique({
    where: { siteId },
    select: { items: { select: { type: true, contentId: true } } },
  })
  const layoutSkriptIds = layout?.items.filter(i => i.type === 'skript').map(i => i.contentId) ?? []
  const layoutCollectionIds = layout?.items.filter(i => i.type === 'collection').map(i => i.contentId) ?? []
  const or: Prisma.SkriptWhereInput[] = [
    { collectionSkripts: { some: { collection: { siteId } } } },
  ]
  if (layoutSkriptIds.length) or.push({ id: { in: layoutSkriptIds } })
  if (layoutCollectionIds.length) {
    or.push({ collectionSkripts: { some: { collectionId: { in: layoutCollectionIds } } } })
  }
  return { OR: or }
}

/** True when the skript is placed on the site. */
export async function isSkriptPlacedOnSite(skriptId: string, siteId: string): Promise<boolean> {
  const inOwnedCollection = await prisma.collectionSkript.count({
    where: { skriptId, collection: { siteId } },
  })
  if (inOwnedCollection > 0) return true
  const layout = await prisma.pageLayout.findUnique({
    where: { siteId },
    select: { items: { select: { type: true, contentId: true } } },
  })
  if (!layout) return false
  if (layout.items.some(i => i.type === 'skript' && i.contentId === skriptId)) return true
  const layoutCollectionIds = layout.items.filter(i => i.type === 'collection').map(i => i.contentId)
  if (layoutCollectionIds.length === 0) return false
  const viaLayoutCollection = await prisma.collectionSkript.count({
    where: { skriptId, collectionId: { in: layoutCollectionIds } },
  })
  return viaLayoutCollection > 0
}

/**
 * What a user_data `itemId` refers to. Pages, skript front pages and skripts
 * resolve to their skript (placement decides); a site front page belongs to
 * exactly its site; anything else ('global', '__global__', orphaned ids) is
 * not content.
 */
export type ItemTarget =
  | { kind: 'skript'; skriptId: string }
  | { kind: 'site-frontpage'; siteId: string }
  | { kind: 'none' }

export async function resolveItemTarget(itemId: string): Promise<ItemTarget> {
  const page = await prisma.page.findUnique({ where: { id: itemId }, select: { skriptId: true } })
  if (page) return { kind: 'skript', skriptId: page.skriptId }
  const fp = await prisma.frontPage.findUnique({
    where: { id: itemId },
    select: { siteId: true, skriptId: true },
  })
  if (fp?.siteId) return { kind: 'site-frontpage', siteId: fp.siteId }
  if (fp?.skriptId) return { kind: 'skript', skriptId: fp.skriptId }
  const skript = await prisma.skript.findUnique({ where: { id: itemId }, select: { id: true } })
  if (skript) return { kind: 'skript', skriptId: skript.id }
  return { kind: 'none' }
}

/**
 * True when data for `itemId` may live on `siteId`: content items must be
 * placed there; non-content ids (per-user settings keyed 'global' etc.) are
 * allowed on any existing site — they are still partitioned by siteId, so
 * nothing crosses sites.
 */
export async function isItemPlacedOnSite(itemId: string, siteId: string): Promise<boolean> {
  const target = await resolveItemTarget(itemId)
  if (target.kind === 'site-frontpage') return target.siteId === siteId
  if (target.kind === 'skript') return isSkriptPlacedOnSite(target.skriptId, siteId)
  return (await prisma.site.count({ where: { id: siteId } })) > 0
}

/** Placement sites of the page's skript. [] for unknown pages. */
export async function getPlacementSiteIdsForPage(pageId: string): Promise<string[]> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { skriptId: true } })
  if (!page) return []
  return getPlacementSiteIdsForSkript(page.skriptId)
}
