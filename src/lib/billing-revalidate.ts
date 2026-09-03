/**
 * Cache busting after billingPlan changes.
 *
 * getTeacherByPageSlug caches billingPlan and the supporter-badge settings
 * with revalidate:false, so a plan change (activation, expiry, refund) must
 * flush the tags or public pages keep the old badge/gates indefinitely.
 * Server-only (next/cache) — kept out of src/lib/billing.ts, which client
 * components import.
 *
 * Koyeb caveat: revalidateTag only reaches THIS instance's ISR cache; other
 * instances serve stale HTML until their own revalidation. Same limitation as
 * every settings write (see src/app/api/user/sidebar-preference/route.ts).
 */

import { revalidateTag } from 'next/cache'
import { prisma } from './prisma'
import { CACHE_TAGS } from './cached-queries'

/** Flush cached public-page data for every site the user owns. Never throws. */
export async function revalidateUserSites(userId: string): Promise<void> {
  try {
    const sites = await prisma.site.findMany({ where: { userId }, select: { slug: true } })
    for (const { slug } of sites) {
      revalidateTag(CACHE_TAGS.user(slug), { expire: 0 })
      revalidateTag(CACHE_TAGS.teacherContent(slug), { expire: 0 })
    }
  } catch (error) {
    // Stale cache beats a failed billing operation.
    console.error('[billing-revalidate] failed for user', userId, error)
  }
}
