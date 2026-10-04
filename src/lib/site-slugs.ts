/**
 * Site slug renames without broken references.
 *
 * Plugins are addressed as `<site slug>/<plugin slug>` and public pages live
 * under `/<site slug>/…`, so renaming a site used to break every plugin tag
 * and every link pointing at the old slug. A rename now leaves the old slug
 * behind as a SiteSlugAlias:
 * - plugin lookups match a site by its current slug or any old one
 *   (siteHasOrHadSlug),
 * - public teacher pages redirect an old slug to the current one
 *   (currentSlugForAlias, used in src/app/org/[orgSlug]/[pageSlug]/…),
 * - an old slug stays reserved for its site (isSiteSlugTaken), otherwise
 *   someone else could claim it and take over those references.
 *
 * Aliases are never expired. Renaming back to an old slug drops that alias.
 *
 * Public old-slug URLs are redirected in the proxy (src/proxy.ts) from an
 * in-process copy of getSlugAliasMap(), refreshed at most once a minute via
 * /api/internal/slug-aliases. The page-level redirect in the teacher routes
 * stays as a fallback for that minute; on its own it sent a doubled Location
 * header on the first (uncached) render in prod (`/a,/a`), so the first
 * visitor of an old URL got a 404.
 */

import { revalidateTag, unstable_cache } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const SLUG_ALIASES_TAG = 'site-slug-aliases'

/**
 * Every old slug → current slug. Served from the Next data cache, so the
 * proxy's once-a-minute refresh doesn't keep the database awake; only a
 * rename (invalidateSlugAliases) makes it query again. Small: one row per
 * rename ever made.
 */
export const getSlugAliasMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const rows = await prisma.siteSlugAlias.findMany({ select: { slug: true, site: { select: { slug: true } } } })
    return Object.fromEntries(rows.map(r => [r.slug, r.site.slug]))
  },
  ['site-slug-alias-map'],
  { tags: [SLUG_ALIASES_TAG], revalidate: false }
)

/** Call after a rename has committed. */
export function invalidateSlugAliases(): void {
  // expire: 0 — the entry uses revalidate: false (same as invalidateDomainCache).
  revalidateTag(SLUG_ALIASES_TAG, { expire: 0 })
}

// The extended client's transaction type (same pattern as exam-recovery.ts).
type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** Prisma filter for a Site that has `slug` now or had it before a rename. */
export function siteHasOrHadSlug(slug: string): Prisma.SiteWhereInput {
  return { OR: [{ slug }, { slugAliases: { some: { slug } } }] }
}

/** Current slug of the site that used `slug` before a rename, or null. */
export async function currentSlugForAlias(slug: string): Promise<string | null> {
  const alias = await prisma.siteSlugAlias.findUnique({
    where: { slug },
    select: { site: { select: { slug: true } } },
  })
  return alias?.site.slug ?? null
}

/**
 * Is `slug` held by another site, as its current slug or an old one?
 * `own.siteId` exempts that site; `own.userId` exempts every site of that user
 * (the check-slug UI asks per user, not per site).
 */
export async function isSiteSlugTaken(
  slug: string,
  own: { siteId?: string | null; userId?: string | null } = {}
): Promise<boolean> {
  const [site, alias] = await Promise.all([
    prisma.site.findUnique({ where: { slug }, select: { id: true, userId: true } }),
    prisma.siteSlugAlias.findUnique({ where: { slug }, select: { site: { select: { id: true, userId: true } } } }),
  ])
  const isOwn = (holder: { id: string; userId: string | null }) =>
    holder.id === own.siteId || (!!own.userId && holder.userId === own.userId)
  return (!!site && !isOwn(site)) || (!!alias && !isOwn(alias.site))
}

/**
 * Bookkeeping after a site's slug changed from `oldSlug` to `newSlug`:
 * keep `oldSlug` as an alias, drop an alias equal to `newSlug` (renaming
 * back), and rewrite `<plugin src="oldSlug/…">` to the new slug in pages of
 * skripts the owner authors. The rewrite only tidies the source — the alias
 * already keeps old srcs working, including in other teachers' pages.
 *
 * Pass the transaction the slug update runs in.
 */
export async function recordSiteSlugRename(
  tx: TransactionClient,
  { siteId, userId, oldSlug, newSlug }: { siteId: string; userId: string | null; oldSlug: string; newSlug: string }
): Promise<void> {
  if (!oldSlug || oldSlug === newSlug) return

  await tx.siteSlugAlias.deleteMany({ where: { slug: newSlug, siteId } })
  await tx.siteSlugAlias.upsert({
    where: { slug: oldSlug },
    create: { slug: oldSlug, siteId },
    update: { siteId },
  })

  if (!userId) return
  // Slugs are [a-z0-9-], but escape regex metacharacters anyway.
  const escaped = oldSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await tx.$executeRaw`
    UPDATE pages
    SET content = regexp_replace(content, ${`(<plugin[^>]*[[:space:]]src=")${escaped}/`}, ${`\\1${newSlug}/`}, 'g')
    WHERE content LIKE ${`%src="${oldSlug}/%`}
      AND "skriptId" IN (SELECT "skriptId" FROM skript_authors WHERE "userId" = ${userId})
  `
}
