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
