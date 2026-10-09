import 'server-only'
import { revalidateTag, unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { getPlacementSiteIdsForSkript } from '@/lib/site-access'
import type { ResolvedPage } from './page-stable-link'

/**
 * Look up canonical URLs for a batch of stable-link page IDs.
 *
 * Returns a map keyed by id. Missing/unpublished pages are absent from the
 * map — the rewrite plugin then leaves their hrefs as `/p/{id}` and the
 * redirect route handles them (404 for unpublished, hides existence).
 *
 * Site scoping (bughunt #7/#15): a page renders only on sites that PLACE its
 * skript, so the URL is built for a placing site:
 *   1. `preferSiteSlug` (the site the linking page is rendered on) if it
 *      places the target — in-content links keep students on their site;
 *   2. else a placing personal site of the skript's first author;
 *   3. else the oldest placing site.
 * Personal site → `/{slug}/{skript}/{page}`, org site → `/org/{slug}/c/{skript}/{page}`.
 * Pages whose skript is placed nowhere are absent (the /p route 404s).
 */
export async function resolveStableLinks(
  ids: string[],
  preferSiteSlug?: string | null,
): Promise<Map<string, ResolvedPage>> {
  const map = new Map<string, ResolvedPage>()
  if (ids.length === 0) return map

  const pages = await prisma.page.findMany({
    where: {
      id: { in: ids },
      isPublished: true,
      skript: { isPublished: true },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      skript: {
        select: {
          id: true,
          slug: true,
          authors: {
            where: { permission: 'author' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { userId: true },
          },
        },
      },
    },
  })

  // One placement lookup per distinct skript (O(skripts), not O(links)).
  const skriptIds = [...new Set(pages.map(p => p.skript.id))]
  const placementBySkript = new Map<string, string[]>()
  await Promise.all(skriptIds.map(async (sid) => {
    placementBySkript.set(sid, await getPlacementSiteIdsForSkript(sid))
  }))
  const allSiteIds = [...new Set([...placementBySkript.values()].flat())]
  const sites = allSiteIds.length
    ? await prisma.site.findMany({
        where: { id: { in: allSiteIds } },
        select: { id: true, slug: true, userId: true, organizationId: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : []

  for (const page of pages) {
    const placed = new Set(placementBySkript.get(page.skript.id) ?? [])
    const candidates = sites.filter(s => placed.has(s.id))
    if (candidates.length === 0) continue
    const authorId = page.skript.authors[0]?.userId
    const site =
      (preferSiteSlug ? candidates.find(s => s.slug === preferSiteSlug) : undefined) ??
      (authorId ? candidates.find(s => s.userId === authorId) : undefined) ??
      candidates[0]
    const base = site.organizationId ? `/org/${site.slug}/c` : `/${site.slug}`
    map.set(page.id, {
      id: page.id,
      title: page.title,
      url: `${base}/${page.skript.slug}/${page.slug}`,
    })
  }

  return map
}

/**
 * Coarse tag for every cached stable-link entry.
 *
 * A page's canonical URL is built from three slugs (site / skript / page), so
 * renaming a skript or a site invalidates every child page's redirect at once.
 * Firing per-page tags for that would mean fetching the page ids first; this
 * tag drops the lot instead, which is cheap because the entries rebuild from a
 * single indexed query. Page-level changes use CACHE_TAGS.page(id) — see
 * src/lib/services/pages.ts.
 */
export const STABLE_LINK_TAG = 'stable-links'

/** Drop every cached stable-link redirect. */
export function invalidateStableLinks(): void {
  revalidateTag(STABLE_LINK_TAG, { expire: 0 })
}

/**
 * Convenience: resolve a single id — cached.
 *
 * The /p/{id} route hits this on every request, and an uncached query there
 * wakes the managed Postgres (it sleeps only after 5 minutes without a
 * connection). Invalidation is explicit rather than time-based:
 * CACHE_TAGS.page(id) covers publishing, unpublishing, renaming and deleting
 * the page itself; STABLE_LINK_TAG covers skript and site renames, which
 * change the URL of every page beneath them.
 */
export async function resolveStableLink(id: string): Promise<ResolvedPage | null> {
  return unstable_cache(
    async () => {
      const map = await resolveStableLinks([id])
      return map.get(id) ?? null
    },
    [`stable-link-${id}`],
    { tags: [CACHE_TAGS.page(id), STABLE_LINK_TAG], revalidate: false }
  )()
}
