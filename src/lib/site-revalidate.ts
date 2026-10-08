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

import { revalidatePath } from 'next/cache'
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
