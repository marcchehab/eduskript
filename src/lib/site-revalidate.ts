/**
 * ISR invalidation for one (item, site) pair after its public layer changed.
 *
 * Public layers are per (page, site) (src/lib/public-page-data.ts). The
 * cached layer data is dropped via revalidateTag(CACHE_TAGS.page(itemId)) by
 * the caller; this helper additionally revalidates the HTML paths of the ONE
 * site that changed:
 *   personal site: /{slug}, /{slug}/{skript}, /{slug}/{skript}/{page}
 *   org site:      /org/{slug}, /org/{slug}/c/{skript}, /org/{slug}/c/{skript}/{page}
 * (eduskript.org/<slug> is rewritten to /org/eduskript/<slug>/… by the proxy;
 * those org-teacher routes read getPublicLayers, which the tag covers.)
 *
 * Koyeb-era caveat still applies: revalidatePath only clears the receiving
 * instance; public layers reconcile client-side on focus.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { getPlacementSiteIdsForSkript } from '@/lib/site-access'
import { prisma } from '@/lib/prisma'

export async function revalidateItemOnSite(itemId: string, siteId: string): Promise<void> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { slug: true, organizationId: true },
  })
  if (!site) return
  const base = site.organizationId ? `/org/${site.slug}` : `/${site.slug}`
  const skriptBase = site.organizationId ? `${base}/c` : base

  const page = await prisma.page.findUnique({
    where: { id: itemId },
    select: { slug: true, skript: { select: { slug: true } } },
  })
  if (page) {
    revalidatePath(`${skriptBase}/${page.skript.slug}/${page.slug}`)
    return
  }

  const frontPage = await prisma.frontPage.findUnique({
    where: { id: itemId },
    select: { siteId: true, skript: { select: { slug: true } } },
  })
  if (!frontPage) return
  if (frontPage.siteId) revalidatePath(base)
  if (frontPage.skript) revalidatePath(`${skriptBase}/${frontPage.skript.slug}`)
}

export interface PlacingSite { slug: string; organizationId: string | null }

/** Sites that currently place the skript (src/lib/site-access.ts rule). Load
 *  BEFORE deleting a skript — collection memberships cascade away. */
export async function getPlacingSites(skriptId: string): Promise<PlacingSite[]> {
  const ids = await getPlacementSiteIdsForSkript(skriptId)
  if (ids.length === 0) return []
  return prisma.site.findMany({ where: { id: { in: ids } }, select: { slug: true, organizationId: true } })
}

/**
 * Bughunt #4/#14: content edits (skript publish/unpublish/rename/delete, page
 * edits) must invalidate EVERY site that places the skript, not just the
 * editor's primary site — getPublishedPage & co. are cached per placing site
 * with revalidate:false. Tags: personal → skriptBySlug/pageBySlug/
 * teacherContent (also covers the org-teacher route eduskript.org/<slug>);
 * org → orgContent. Plus the HTML paths.
 */
export async function revalidateSkriptOnPlacingSites(
  skriptId: string,
  skriptSlugs: string[],
  pageSlugs: string[] = [],
  sites?: PlacingSite[],
): Promise<void> {
  const placing = sites ?? await getPlacingSites(skriptId)
  const slugs = [...new Set(skriptSlugs.filter(Boolean))]
  for (const site of placing) {
    if (site.organizationId) {
      revalidateTag(CACHE_TAGS.orgContent(site.slug), { expire: 0 })
      for (const s of slugs) {
        revalidatePath(`/org/${site.slug}/c/${s}`)
        for (const p of pageSlugs) revalidatePath(`/org/${site.slug}/c/${s}/${p}`)
      }
      continue
    }
    revalidateTag(CACHE_TAGS.teacherContent(site.slug), { expire: 0 })
    for (const s of slugs) {
      revalidateTag(CACHE_TAGS.skriptBySlug(site.slug, s), { expire: 0 })
      revalidatePath(`/${site.slug}/${s}`)
      for (const p of pageSlugs) {
        revalidateTag(CACHE_TAGS.pageBySlug(site.slug, s, p), { expire: 0 })
        revalidatePath(`/${site.slug}/${s}/${p}`)
      }
    }
  }
}
