import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// A user can own multiple sites (superadmin-provisioned). The "primary" site —
// used for post-login redirect, cross-domain tokens, AI teacher-preference
// prompt, and any legacy single-slug fallback — is the one with the lowest
// `order`, ties broken by oldest `createdAt`. Use this ordering everywhere a
// single site must be picked for a user so the choice is stable.
//
// Usage:
//  - standalone:  prisma.site.findFirst({ where: { userId }, orderBy: PRIMARY_SITE_ORDER })
//  - nested read: user select `sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, ... }`,
//                 then read `user.sites[0]`.
export const PRIMARY_SITE_ORDER: Prisma.SiteOrderByWithRelationInput[] = [
  { order: 'asc' },
  { createdAt: 'asc' },
]

/** The user's primary site id, or null. */
export async function getPrimarySiteId(userId: string): Promise<string | null> {
  const site = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true },
  })
  return site?.id ?? null
}

/**
 * Resolve which of the user's sites a per-site settings request targets.
 *
 * - `siteId` given → ownership-check it. `forbidden: true` (site null) if the
 *   id isn't one of the caller's sites — the route should return 403.
 * - `siteId` omitted → the primary site (back-compat for the pre-multi-site
 *   settings UI, which had no site picker). `site` is null only if the user
 *   owns no site yet (OAuth-signup teacher who hasn't claimed a slug).
 *
 * Callers pass `siteId` from the query string (GET) or body (PATCH/PUT).
 */
export async function resolveOwnedSite(
  userId: string,
  siteId?: string | null,
): Promise<{ site: { id: string; slug: string } | null; forbidden: boolean }> {
  if (siteId) {
    const owned = await prisma.site.findFirst({
      where: { id: siteId, userId },
      select: { id: true, slug: true },
    })
    return { site: owned ?? null, forbidden: !owned }
  }
  const primary = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true },
  })
  return { site: primary ?? null, forbidden: false }
}
