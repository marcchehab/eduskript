import { revalidateTag } from 'next/cache'
import { CACHE_TAGS } from '@/lib/cached-queries'

/**
 * Drop the cached domain→site mapping for `domain`.
 *
 * Call after any write that changes what a domain resolves to: verification,
 * deletion, or re-pointing (isPrimary/siteId). Without this the proxy would
 * keep serving the previous mapping until its own in-process map expires and
 * the underlying unstable_cache entry is rebuilt — and that entry has
 * `revalidate: false`, so it would never rebuild on its own.
 *
 * Cheap and idempotent; safe to call for a domain that was never cached.
 */
export function invalidateDomainCache(domain: string): void {
  // `expire: 0` — the cached entry uses `revalidate: false`, so without an
  // explicit expiry the tag sweep would leave it serving stale forever.
  revalidateTag(CACHE_TAGS.customDomain(domain), { expire: 0 })
}
