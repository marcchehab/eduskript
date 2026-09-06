/**
 * Pure assembly logic for the public site directory (/api/sites.json).
 *
 * Teacher sites only — org sites (including the eduskript.org default org,
 * whose site would otherwise list the platform itself) are excluded by the
 * route's query. Split from the route so the URL/name/opt-out rules are
 * unit-testable without a database.
 */

import { readExtraSettings } from '@/lib/settings'

/** One entry in the published directory. Shape is a public contract. */
export interface DirectoryEntry {
  url: string
  name: string
  description: string | null
  language: string
}

/** The subset of a Site row the directory needs (see route for the query). */
export interface DirectorySiteRow {
  id: string
  slug: string
  userId: string | null
  pageName: string | null
  pageDescription: string | null
  pageLanguage: string | null
  extraSettings: unknown
  user: { name: string | null } | null
  /** Verified teacher domains attached to THIS site (siteId set), primary first. */
  teacherCustomDomains: { domain: string }[]
}

const APP_HOST = 'eduskript.org'

/**
 * Build directory entries from queried teacher-site rows.
 *
 * `legacyDomainBySiteId` maps a site id to a verified TeacherCustomDomain
 * whose row predates multi-site (siteId null): those resolve to the user's
 * primary site at request time, so the caller pre-resolves them the same way.
 */
export function buildDirectoryEntries(
  sites: DirectorySiteRow[],
  legacyDomainBySiteId: Map<string, string> = new Map()
): DirectoryEntry[] {
  const entries: DirectoryEntry[] = []

  for (const site of sites) {
    if (readExtraSettings(site).directoryOptOut) continue

    const domain =
      site.teacherCustomDomains[0]?.domain ?? legacyDomainBySiteId.get(site.id)

    // Guard against a domain row for the app host itself sneaking in — the
    // /slug form is the only correct URL there.
    const url =
      domain && domain !== APP_HOST && domain !== `www.${APP_HOST}`
        ? `https://${domain}`
        : `https://${APP_HOST}/${site.slug}`

    entries.push({
      url,
      name: site.pageName || site.user?.name || site.slug,
      // Raw pageDescription — may contain inline markdown, consumers strip it.
      description: site.pageDescription || null,
      // BCP-47 tag as stored; null means English (schema convention).
      language: site.pageLanguage || 'en',
    })
  }

  return entries
}
