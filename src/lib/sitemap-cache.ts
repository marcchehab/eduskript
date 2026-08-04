import { revalidateTag } from 'next/cache'

/**
 * Tag for the per-host sitemap enumeration (src/app/sitemap.ts).
 *
 * It used to be `revalidate: 3600`, which meant one DB query per host per hour
 * forever. That sounds negligible and is not: the managed Postgres sleeps only
 * after 5 uninterrupted minutes without a connection, so three hosts waking it
 * hourly cost far more awake-time than the queries themselves suggest. A
 * sitemap only changes when content is published, unpublished, renamed or
 * moved, so it is invalidated from those writers instead.
 */
export const SITEMAP_TAG = 'sitemaps'

/** Drop every host's cached sitemap enumeration. */
export function invalidateSitemaps(): void {
  revalidateTag(SITEMAP_TAG, { expire: 0 })
}
