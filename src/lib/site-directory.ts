/**
 * Pure assembly logic for the public site directory (/api/sites.json).
 *
 * Split from the route so the URL/name/opt-out rules are unit-testable
 * without a database. The route does the Prisma queries and feeds rows in.
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
  organization: {
    name: string
    /** Verified org domains, primary first. */
    customDomains: { domain: string }[]
  } | null
  /** Verified teacher domains attached to THIS site (siteId set), primary first. */
  teacherCustomDomains: { domain: string }[]
}

const APP_HOST = 'eduskript.org'

/**
 * Build directory entries from queried site rows.
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
      site.teacherCustomDomains[0]?.domain ??
      legacyDomainBySiteId.get(site.id) ??
      site.organization?.customDomains[0]?.domain

    // eduskript.org itself can appear as the default org's CustomDomain row;
    // normalize so the platform site doesn't get a "/slug"-less duplicate form.
    const url =
      domain && domain !== APP_HOST && domain !== `www.${APP_HOST}`
        ? `https://${domain}`
        : `https://${APP_HOST}/${site.slug}`

    entries.push({
      url,
      name: site.pageName || site.user?.name || site.organization?.name || site.slug,
      // Raw pageDescription — may contain inline markdown, consumers strip it.
      description: site.pageDescription || null,
      // BCP-47 tag as stored; null means English (schema convention).
      language: site.pageLanguage || 'en',
    })
  }

  return entries
}
