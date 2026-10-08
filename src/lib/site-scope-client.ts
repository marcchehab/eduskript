/**
 * Client helpers for passing the current site to site-scoped exam APIs
 * (src/lib/site-access.ts). The current site is whatever CurrentSiteProvider
 * set on the user-data service ('' outside a site route, e.g. the dashboard).
 *
 * Teacher per-student endpoints treat a missing siteId as "resolve the
 * student's site within my managed sites", so on the dashboard nothing is
 * appended and the server picks; inside a site route the current site is sent
 * so the in-exam view shows THIS site's attempt.
 */

import { userDataService } from '@/lib/userdata/userDataService'

/** The current site id, or null outside a site route. */
export function currentSiteId(): string | null {
  return userDataService.getCurrentSite() || null
}

/** Append `siteId=<explicit ?? current>` to a URL when a site is known. */
export function withSite(url: string, siteId?: string | null): string {
  const sid = siteId ?? currentSiteId()
  if (!sid) return url
  return `${url}${url.includes('?') ? '&' : '?'}siteId=${encodeURIComponent(sid)}`
}
