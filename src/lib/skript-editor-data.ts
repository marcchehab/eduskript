import { prisma } from '@/lib/prisma'
import { getPlacementSiteIdsForSkript } from '@/lib/site-access'
import { checkSkriptPermissions } from '@/lib/permissions'

/**
 * Skript-level data for the page editor, shared by the page edit route and
 * the skript front-page route (both render PageEditor).
 */

const SITE_SELECT = { id: true, slug: true, organizationId: true } as const

export async function loadSkriptForEditor(skriptSlug: string, userId: string, isAdmin: boolean) {
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      ...(isAdmin ? {} : {
        authors: {
          some: { userId }
        }
      })
    },
    include: {
      pages: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          isPublished: true,
          isUnlisted: true,
          pageType: true,
        }
      },
      authors: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              title: true,
            }
          }
        }
      },
      collectionSkripts: {
        include: {
          collection: true
        }
      },
      frontPage: { select: { id: true, content: true, isPublished: true } },
    }
  })

  if (!skript) return null

  const permissions = checkSkriptPermissions(userId, skript.authors, isAdmin)

  // Placed = the skript, or a collection containing it, is in some site's
  // PageLayout (anyone's: a co-author's skript counts if the owner placed it).
  // Unplaced skripts are missing from the public sidebar; the URL still works.
  const collectionIds = skript.collectionSkripts.map((cs) => cs.collectionId)
  const placement = await prisma.pageLayoutItem.findFirst({
    where: {
      OR: [
        { type: 'skript', contentId: skript.id },
        ...(collectionIds.length ? [{ type: 'collection', contentId: { in: collectionIds } }] : []),
      ],
    },
    select: { id: true },
  })

  // The site this skript is shown on, deterministically (bughunt #8): among
  // the sites that PLACE it (src/lib/site-access.ts), the viewer's own site
  // first, then the oldest. Falls back to its collection's site. Drives the
  // editor's back link, public URLs and the exam assign/state controls —
  // those need `ownedByViewer` (classes only exist on the viewer's own
  // personal site; another teacher's placement must never be targeted).
  const placingIds = await getPlacementSiteIdsForSkript(skript.id)
  const placingSites = placingIds.length
    ? await prisma.site.findMany({
        where: { id: { in: placingIds } },
        select: { ...SITE_SELECT, userId: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : []
  const collectionSiteId = skript.collectionSkripts[0]?.collection?.siteId
  const chosen = placingSites.find((s) => s.userId === userId)
    ?? placingSites[0]
    ?? (collectionSiteId
      ? await prisma.site.findUnique({ where: { id: collectionSiteId }, select: { ...SITE_SELECT, userId: true } })
      : null)
  const site = chosen
    ? { id: chosen.id, slug: chosen.slug, organizationId: chosen.organizationId, ownedByViewer: chosen.userId === userId }
    : null

  return { skript, permissions, placed: !!placement, site }
}

/** The skript prop shape PageEditor expects. */
export function toEditorSkript(skript: NonNullable<Awaited<ReturnType<typeof loadSkriptForEditor>>>['skript']) {
  return {
    id: skript.id,
    slug: skript.slug,
    title: skript.title,
    description: skript.description,
    isPublished: skript.isPublished,
    isUnlisted: skript.isUnlisted,
    pages: skript.pages,
    authors: skript.authors,
    collectionSkripts: skript.collectionSkripts,
  }
}
