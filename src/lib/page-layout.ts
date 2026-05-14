import { prisma } from './prisma'
import { canEditSite, checkSkriptPermissions, type OrgRole } from './permissions'

/** A raw page-layout item row — a reference to a collection or skript. */
export interface LayoutItemRow {
  type: string
  contentId: string
  order: number
}

/** Who's viewing the layout — drives per-item edit permissions. */
export interface LayoutViewer {
  userId: string
  isAdmin: boolean
  /** Org memberships, for collections owned by an org site. Empty for a
   *  user's own page layout (its collections live on the user's own site). */
  orgRoles: OrgRole[]
}

interface HydratedPermissions {
  canEdit: boolean
  canView: boolean
}

export interface HydratedLayoutSkript {
  id: string
  type: 'skript'
  title: string
  description: string | null
  order: number
  slug: string
  parentId?: string
  permissions: HydratedPermissions
  isInLayout?: boolean
  isPublished: boolean
  isUnlisted: boolean
}

export interface HydratedLayoutCollection {
  id: string
  type: 'collection'
  title: string
  accentColor: string | null
  order: number
  permissions: HydratedPermissions
  skripts: HydratedLayoutSkript[]
}

export type HydratedLayoutItem = HydratedLayoutCollection | HydratedLayoutSkript

/**
 * Resolve raw page-layout item rows into fully-hydrated items — collections
 * with their nested skripts, every node carrying its edit/view permissions.
 *
 * Two queries total (collections + root skripts) regardless of layout size.
 * The page builder previously assembled the same thing client-side with
 * `1 + N + N×M + R` separate API round-trips. Orphan rows (content since
 * deleted) are dropped; a skript that is both a root item and a member of a
 * pinned collection is kept only inside the collection.
 */
export async function hydratePageLayoutItems(
  items: LayoutItemRow[],
  viewer: LayoutViewer
): Promise<HydratedLayoutItem[]> {
  const collectionIds = items.filter(i => i.type === 'collection').map(i => i.contentId)
  const skriptIds = items.filter(i => i.type === 'skript').map(i => i.contentId)

  const [collections, rootSkripts] = await Promise.all([
    collectionIds.length
      ? prisma.collection.findMany({
          where: { id: { in: collectionIds } },
          include: {
            site: { select: { userId: true, organizationId: true } },
            collectionSkripts: {
              orderBy: { order: 'asc' },
              include: {
                skript: {
                  include: { authors: { include: { user: { select: { id: true } } } } },
                },
              },
            },
          },
        })
      : [],
    skriptIds.length
      ? prisma.skript.findMany({
          where: { id: { in: skriptIds } },
          include: { authors: { include: { user: { select: { id: true } } } } },
        })
      : [],
  ])

  const collectionById = new Map(collections.map(c => [c.id, c]))
  const skriptById = new Map(rootSkripts.map(s => [s.id, s]))

  const hydrated: HydratedLayoutItem[] = []
  for (const item of items) {
    if (item.type === 'collection') {
      const collection = collectionById.get(item.contentId)
      if (!collection) continue // orphan layout row — content was deleted
      const canEdit = canEditSite(viewer.userId, collection.site, viewer.orgRoles, viewer.isAdmin)
      hydrated.push({
        id: collection.id,
        type: 'collection',
        title: collection.title,
        accentColor: collection.accentColor ?? null,
        order: item.order,
        permissions: { canEdit, canView: true },
        skripts: collection.collectionSkripts.map(cs => {
          const perms = checkSkriptPermissions(viewer.userId, cs.skript.authors, viewer.isAdmin)
          return {
            id: cs.skript.id,
            type: 'skript' as const,
            title: cs.skript.title,
            description: cs.skript.description,
            order: cs.order,
            slug: cs.skript.slug,
            parentId: collection.id,
            permissions: { canEdit: perms.canEdit, canView: perms.canView },
            isInLayout: true,
            isPublished: cs.skript.isPublished,
            isUnlisted: cs.skript.isUnlisted,
          }
        }),
      })
    } else if (item.type === 'skript') {
      const skript = skriptById.get(item.contentId)
      if (!skript) continue // orphan layout row
      const perms = checkSkriptPermissions(viewer.userId, skript.authors, viewer.isAdmin)
      hydrated.push({
        id: skript.id,
        type: 'skript',
        title: skript.title,
        description: skript.description,
        order: item.order,
        slug: skript.slug,
        permissions: { canEdit: perms.canEdit, canView: perms.canView },
        isPublished: skript.isPublished,
        isUnlisted: skript.isUnlisted,
      })
    }
  }

  // A skript can be both a root layout item and a member of a pinned
  // collection — render it only inside the collection.
  const skriptsInCollections = new Set(
    hydrated.flatMap(i => (i.type === 'collection' ? i.skripts.map(s => s.id) : []))
  )
  return hydrated.filter(i => i.type !== 'skript' || !skriptsInCollections.has(i.id))
}
