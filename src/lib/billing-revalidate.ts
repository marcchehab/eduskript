/**
 * Cache busting after billingPlan changes.
 *
 * getTeacherByPageSlug caches billingPlan and the supporter-badge settings
 * with revalidate:false, so a plan change (activation, expiry, refund) must
 * flush the tags or public pages keep the old badge/gates indefinitely.
 * Server-only (next/cache) — kept out of src/lib/billing.ts, which client
 * components import.
 *
 * Multi-instance caveat: revalidateTag only reaches THIS instance's ISR cache.
 * Production runs one app container (config/deploy.yml), so this is exact;
 * during a deploy's ~30 s overlap the old container may keep stale HTML until
 * it stops. Same limitation as every settings write.
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
