import 'server-only'
import { prisma } from '@/lib/prisma'
import type { ResolvedPage } from './page-stable-link'

/**
 * Look up canonical URLs for a batch of stable-link page IDs.
 *
 * Returns a map keyed by id. Missing/unpublished pages are absent from the
 * map — the rewrite plugin then leaves their hrefs as `/p/{id}` and the
 * redirect route handles them (404 for unpublished, hides existence).
 *
 * URL shape: uses the first author's pageSlug as the domain segment, mirroring
 * the dashboard's "View public page" button (page-editor.tsx). Org URLs
 * (`/org/...`) are not constructed in V1; an admin-org skript will resolve
 * via its admin's personal pageSlug, which is fine for SEO since both routes
 * serve the same content.
 */
export async function resolveStableLinks(ids: string[]): Promise<Map<string, ResolvedPage>> {
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
          slug: true,
          authors: {
            where: { permission: 'author' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: {
              user: { select: { site: { select: { slug: true } } } },
            },
          },
        },
      },
    },
  })

  for (const page of pages) {
    const author = page.skript.authors[0]
    const domain = author?.user?.site?.slug
    if (!domain) continue
    map.set(page.id, {
      id: page.id,
      title: page.title,
      url: `/${domain}/${page.skript.slug}/${page.slug}`,
    })
  }

  return map
}

/** Convenience: resolve a single id. */
export async function resolveStableLink(id: string): Promise<ResolvedPage | null> {
  const map = await resolveStableLinks([id])
  return map.get(id) ?? null
}
