import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { buildDirectoryEntries, type DirectoryEntry } from '@/lib/site-directory'

/**
 * GET /api/sites.json — public directory of all publicly reachable sites,
 * for external services (Atlas and friends) that crawl it ~daily.
 *
 * A site is "public" when at least one of its collections contains a
 * published, listed skript — the same isPublished/isUnlisted criteria the
 * sitemap uses. Sites can opt out via extraSettings.directoryOptOut
 * ("List this site in public directories" toggle in site/org settings).
 *
 * No auth. Response shape is a stable contract:
 *   { "version": 1, "sites": [{ url, name, description, language }] }
 * Extend by ADDING fields; never rename or remove without bumping version.
 */

const getDirectory = unstable_cache(
  async (): Promise<DirectoryEntry[]> => {
    const sites = await prisma.site.findMany({
      where: {
        collections: {
          some: {
            collectionSkripts: {
              some: { skript: { isPublished: true, isUnlisted: false } },
            },
          },
        },
      },
      select: {
        id: true,
        slug: true,
        userId: true,
        pageName: true,
        pageDescription: true,
        pageLanguage: true,
        extraSettings: true,
        user: { select: { name: true } },
        organization: {
          select: {
            name: true,
            customDomains: {
              where: { isVerified: true },
              orderBy: { isPrimary: 'desc' },
              select: { domain: true },
            },
          },
        },
        teacherCustomDomains: {
          where: { isVerified: true },
          orderBy: { isPrimary: 'desc' },
          select: { domain: true },
        },
      },
      orderBy: { slug: 'asc' },
    })

    // Teacher domains from before multi-site have siteId null and resolve to
    // the owner's primary site (see resolve-domain). Pre-resolve them here so
    // those sites still advertise their custom domain as canonical URL.
    const legacyDomains = await prisma.teacherCustomDomain.findMany({
      where: { isVerified: true, siteId: null },
      orderBy: { isPrimary: 'desc' },
      select: { domain: true, userId: true },
    })
    const legacyDomainBySiteId = new Map<string, string>()
    for (const { domain, userId } of legacyDomains) {
      const primary = await prisma.site.findFirst({
        where: { userId },
        orderBy: PRIMARY_SITE_ORDER,
        select: { id: true },
      })
      // First row per site wins (isPrimary desc = primary domain first).
      if (primary && !legacyDomainBySiteId.has(primary.id)) {
        legacyDomainBySiteId.set(primary.id, domain)
      }
    }

    return buildDirectoryEntries(sites, legacyDomainBySiteId)
  },
  ['site-directory'],
  { revalidate: 3600 }
)

export async function GET() {
  const sites = await getDirectory()
  return NextResponse.json(
    { version: 1, sites },
    {
      headers: {
        // Crawlers poll daily; an hour of staleness is fine and keeps the DB
        // quiet (same reasoning as sitemap.ts).
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
    }
  )
}
