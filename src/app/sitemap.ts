import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { getCurrentTenant } from '@/lib/tenant'

// Per-host sitemap. Both eduskript.org and informatikgarten.ch run the same
// Next.js app, so URLs must be tagged with the request host or each tenant's
// sitemap would advertise a mix of cross-domain URLs.
//
// Strategy:
//   1. Always include the homepage and static legal pages.
//   2. Resolve the host to either an Organization (custom domain or app
//      domain) or a teacher User (custom domain), then enumerate that
//      tenant's published skripts and pages.
//   3. Skip auth, dashboard, and exam routes — those are user-private.
//
// `headers()` (read inside getCurrentTenant) makes this dynamic — it must run
// per request, not once at build time.

const APP_DOMAIN_TO_ORG_SLUG: Record<string, string> = {
  'eduskript.org': 'eduskript',
}

interface ResolvedTenant {
  type: 'org'
  orgId: string
  orgSlug: string
}

interface ResolvedTeacher {
  type: 'teacher'
  userId: string
  pageSlug: string
}

type Resolved = ResolvedTenant | ResolvedTeacher | null

async function resolveHost(host: string): Promise<Resolved> {
  const orgSlug = APP_DOMAIN_TO_ORG_SLUG[host]
  if (orgSlug) {
    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, slug: true },
    })
    return org ? { type: 'org', orgId: org.id, orgSlug: org.slug } : null
  }

  const orgDomain = await prisma.customDomain.findFirst({
    where: { domain: host, isVerified: true },
    select: { organization: { select: { id: true, slug: true } } },
  })
  if (orgDomain?.organization) {
    return {
      type: 'org',
      orgId: orgDomain.organization.id,
      orgSlug: orgDomain.organization.slug,
    }
  }

  const teacherDomain = await prisma.teacherCustomDomain.findFirst({
    where: { domain: host, isVerified: true },
    select: { user: { select: { id: true, pageSlug: true } } },
  })
  if (teacherDomain?.user?.pageSlug) {
    return {
      type: 'teacher',
      userId: teacherDomain.user.id,
      pageSlug: teacherDomain.user.pageSlug,
    }
  }

  return null
}

async function getOrgEntries(baseUrl: string, orgId: string): Promise<MetadataRoute.Sitemap> {
  // Mirror getOrgFullSiteStructure: enumerate the collections referenced in
  // the org's page layout, then their published skripts and pages.
  const pageLayout = await prisma.orgPageLayout.findFirst({
    where: { organizationId: orgId },
    select: {
      items: {
        where: { type: 'collection' },
        select: { contentId: true },
      },
    },
  })
  const collectionIds = pageLayout?.items.map(i => i.contentId) ?? []
  if (collectionIds.length === 0) return []

  const collections = await prisma.collection.findMany({
    where: { id: { in: collectionIds } },
    select: {
      collectionSkripts: {
        where: { skript: { isPublished: true, isUnlisted: false } },
        select: {
          skript: {
            select: {
              slug: true,
              pages: {
                where: { isPublished: true, isUnlisted: false },
                select: { slug: true, updatedAt: true },
              },
            },
          },
        },
      },
    },
  })

  const entries: MetadataRoute.Sitemap = []
  for (const collection of collections) {
    for (const cs of collection.collectionSkripts) {
      for (const page of cs.skript.pages) {
        entries.push({
          url: `${baseUrl}/c/${cs.skript.slug}/${page.slug}`,
          lastModified: page.updatedAt,
          changeFrequency: 'weekly',
          priority: 0.7,
        })
      }
    }
  }
  return entries
}

async function getTeacherEntries(baseUrl: string, userId: string): Promise<MetadataRoute.Sitemap> {
  const skripts = await prisma.skript.findMany({
    where: {
      isPublished: true,
      isUnlisted: false,
      authors: { some: { userId, permission: 'author' } },
    },
    select: {
      slug: true,
      pages: {
        where: { isPublished: true, isUnlisted: false },
        select: { slug: true, updatedAt: true },
      },
    },
  })

  const entries: MetadataRoute.Sitemap = []
  for (const skript of skripts) {
    for (const page of skript.pages) {
      entries.push({
        url: `${baseUrl}/${skript.slug}/${page.slug}`,
        lastModified: page.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.7,
      })
    }
  }
  return entries
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await getCurrentTenant()
  const baseUrl = `https://${tenant.host}`
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/impressum`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]

  const resolved = await resolveHost(tenant.host).catch(err => {
    console.error('sitemap: failed to resolve host', tenant.host, err)
    return null
  })

  let dynamicEntries: MetadataRoute.Sitemap = []
  try {
    if (resolved?.type === 'org') {
      dynamicEntries = await getOrgEntries(baseUrl, resolved.orgId)
    } else if (resolved?.type === 'teacher') {
      dynamicEntries = await getTeacherEntries(baseUrl, resolved.userId)
    }
  } catch (err) {
    console.error('sitemap: failed to enumerate tenant content', err)
  }

  return [...staticEntries, ...dynamicEntries]
}
