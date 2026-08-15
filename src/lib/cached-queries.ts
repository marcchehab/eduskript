import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { prisma } from './prisma'
import { buildSiteStructure, type SiteStructure } from './site-structure'
import { createLogger } from './logger'
import { PRIMARY_SITE_ORDER } from './sites'
import { readExtraSettings } from './settings'

const log = createLogger('cache:queries')

// Cache tags for granular invalidation
// Note: pageSlug is the URL slug for a user's public page (e.g., eduskript.org/mypage)
export const CACHE_TAGS = {
  user: (pageSlug: string) => `user:${pageSlug}`,
  collection: (id: string) => `collection:${id}`,
  skript: (id: string) => `skript:${id}`,
  skriptBySlug: (pageSlug: string, skriptSlug: string) =>
    `skript:${pageSlug}:${skriptSlug}`,
  page: (id: string) => `page:${id}`,
  pageBySlug: (pageSlugParam: string, skriptSlug: string, pageSlug: string) =>
    `page:${pageSlugParam}:${skriptSlug}:${pageSlug}`,
  teacherContent: (pageSlug: string) => `teacher-content:${pageSlug}`,
  organization: (slug: string) => `org:${slug}`,
  orgContent: (slug: string) => `org-content:${slug}`,
  customDomain: (domain: string) => `custom-domain:${domain.toLowerCase()}`,
} as const

/** The public-page fields that live on Site but get read off the user object. */
type SitePageFields = {
  slug: string
  pageName: string | null
  pageDescription: string | null
  pageIcon: string | null
  pageLanguage: string | null
  pageTagline: string | null
  sidebarBehavior: string
  typographyPreference: string | null
  extraSettings: unknown
}

/**
 * Graft a Site's public-page fields onto its owner's user object — the
 * backwards-compat shim that lets consumers keep reading `user.pageSlug`,
 * `user.pageName`, etc. without a sweep. Used by getTeacherByPageSlug and
 * getTeacherWithLayout (the latter additionally attaches aiSystemPrompt +
 * pageLayout). Org pages have their own graft — Organization maps the same
 * Site fields under different names (description, iconUrl).
 */
function graftSitePageFields<U extends object>(user: U, site: SitePageFields) {
  const extra = readExtraSettings(site)
  return Object.assign(user, {
    pageSlug: site.slug,
    pageName: site.pageName,
    pageDescription: site.pageDescription,
    pageIcon: site.pageIcon,
    pageLanguage: site.pageLanguage,
    pageTagline: site.pageTagline,
    sidebarBehavior: site.sidebarBehavior,
    typographyPreference: site.typographyPreference,
    titleStyle: extra.titleStyle ?? 'icon',
    logoUrl: extra.logoUrl ?? null,
  })
}

/**
 * Get teacher by page slug - cached
 * Used for public page rendering
 */
export const getTeacherByPageSlug = (pageSlug: string) =>
  unstable_cache(
    async () => {
      log('MISS getTeacherByPageSlug', { pageSlug })
      // URL slug AND page-display fields all live on Site now. Pull both
      // sets in one query, then graft them onto the user object so
      // consumers keep reading `user.pageName`, `user.pageSlug`, etc.
      // without a sweep.
      const site = await prisma.site.findUnique({
        where: { slug: pageSlug },
        select: {
          slug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          pageLanguage: true,
          pageTagline: true,
          sidebarBehavior: true,
          typographyPreference: true,
          extraSettings: true,
          // Canonical host for THIS site: its own verified primary domain (a
          // teacher may own several sites, each with its own custom domain).
          // Reads via the site→domain back-relation, so a non-primary site no
          // longer inherits the primary site's domain.
          teacherCustomDomains: {
            where: { isVerified: true, isPrimary: true },
            select: { domain: true },
            take: 1,
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              title: true,
              bio: true,
              billingPlan: true,
            },
          },
        },
      })
      if (!site?.user) return null
      // Graft page fields onto the user, then attach the SITE's domains under
      // the legacy `customDomains` name so canonical/SEO consumers are unchanged.
      return Object.assign(graftSitePageFields(site.user, site), {
        customDomains: site.teacherCustomDomains,
      })
    },
    [`teacher-${pageSlug}`],
    {
      tags: [CACHE_TAGS.user(pageSlug), 'teachers'],
      revalidate: false,
    }
  )()

// Backwards-compatible alias
export const getTeacherByUsername = getTeacherByPageSlug

/**
 * Get teacher with page layout - cached
 * Used for domain index pages
 */
export const getTeacherWithLayout = (pageSlug: string) =>
  unstable_cache(
    async () => {
      // URL slug, page layout, and page-display fields all live on Site.
      // Look up the site by slug, then graft the site's fields onto the
      // user object so existing accessors (`user.pageSlug`, `user.pageName`,
      // `user.pageLayout`, …) keep working without a sweep.
      const site = await prisma.site.findUnique({
        where: { slug: pageSlug },
        include: {
          user: true,
          pageLayout: {
            include: {
              items: { orderBy: { order: 'asc' } }
            }
          }
        }
      })
      if (!site?.user) return null
      return Object.assign(graftSitePageFields(site.user, site), {
        aiSystemPrompt: site.aiSystemPrompt,
        pageLayout: site.pageLayout ?? null,
      })
    },
    [`teacher-layout-${pageSlug}`],
    {
      tags: [CACHE_TAGS.user(pageSlug), CACHE_TAGS.teacherContent(pageSlug)],
      revalidate: false,
    }
  )()

/**
 * Get all published collections for a teacher - cached
 * Used for full sidebar navigation
 */
export const getAllPublishedCollections = (teacherId: string, pageSlug: string) =>
  unstable_cache(
    async () => {
      return prisma.collection.findMany({
        where: { site: { userId: teacherId } },
        include: {
          collectionSkripts: {
            where: {
              skript: { isPublished: true, isUnlisted: false }
            },
            include: {
              skript: {
                include: {
                  frontPage: { select: { id: true } },
                  pages: {
                    where: { isPublished: true, isUnlisted: false },
                    orderBy: { order: 'asc' },
                    select: {
                      id: true,
                      title: true,
                      slug: true
                    }
                  }
                }
              }
            },
            orderBy: { order: 'asc' }
          }
        },
        orderBy: { updatedAt: 'desc' }
      })
    },
    [`all-published-collections-${pageSlug}`],
    {
      tags: [CACHE_TAGS.teacherContent(pageSlug)],
      revalidate: false,
    }
  )()

/**
 * Get full site structure for sidebar - cached
 * Returns all published collections/skripts/pages in SiteStructure format
 * Used when sidebarBehavior is "full"
 * Respects page layout ordering: collections in page layout order first, then remaining collections
 */
export const getFullSiteStructure = (teacherId: string, pageSlug: string) =>
  unstable_cache(
    async (): Promise<SiteStructure[]> => {
      log('MISS getFullSiteStructure', { pageSlug })
      // Fetch page layout via the user's site (URL slug now lives on Site).
      const pageLayout = await prisma.pageLayout.findFirst({
        where: {
          site: { slug: pageSlug }
        },
        include: {
          items: {
            where: { type: 'collection' },
            orderBy: { order: 'asc' }
          }
        }
      })

      const layoutCollectionIds = pageLayout?.items.map(item => item.contentId) || []

      // Only fetch collections that are in the page layout
      if (layoutCollectionIds.length === 0) {
        return []
      }

      const collections = await prisma.collection.findMany({
        where: {
          id: { in: layoutCollectionIds },
          site: { userId: teacherId },
        },
        select: {
          id: true,
          title: true,
          accentColor: true,
          updatedAt: true,
          collectionSkripts: {
            where: {
              skript: { isPublished: true, isUnlisted: false }
            },
            include: {
              skript: {
                include: {
                  frontPage: { select: { id: true } },
                  pages: {
                    where: { isPublished: true, isUnlisted: false },
                    orderBy: { order: 'asc' },
                    select: {
                      id: true,
                      title: true,
                      slug: true,
                      isPublished: true,
                      order: true
                    }
                  }
                }
              }
            },
            orderBy: { order: 'asc' }
          }
        }
      })

      // Sort collections by page layout order
      const sortedCollections = [...collections].sort((a, b) => {
        const aIndex = layoutCollectionIds.indexOf(a.id)
        const bIndex = layoutCollectionIds.indexOf(b.id)
        return aIndex - bIndex
      })

      return buildSiteStructure(sortedCollections, { onlyPublished: true })
    },
    [`full-site-structure-${pageSlug}`],
    {
      tags: [CACHE_TAGS.teacherContent(pageSlug)],
      revalidate: false,
    }
  )()

/**
 * Get published page content - cached
 * The main content fetch for public pages.
 * Queries skript directly by unique slug (no collection needed in URL).
 */
export const getPublishedPage = (
  teacherId: string,
  skriptSlug: string,
  contentPageSlug: string,
  ownerPageSlug?: string
) =>
  unstable_cache(
    async () => {
      log('MISS getPublishedPage', { skriptSlug, contentPageSlug })
      // Skript slugs are scoped per-user, so query by slug + author
      const skript = await prisma.skript.findFirst({
        where: {
          slug: skriptSlug,
          isPublished: true,
          OR: [
            { authors: { some: { userId: teacherId } } },
            { collectionSkripts: { some: { collection: { site: { userId: teacherId } } } } }
          ]
        },
        include: {
          collectionSkripts: {
            include: {
              collection: true
            },
            orderBy: { order: 'asc' },
            take: 1,
          },
          pages: {
            where: { isPublished: true },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              slug: true,
              description: true,
              content: true,
              order: true,
              isPublished: true,
              isUnlisted: true,
              pageType: true,
              examSettings: true,
              presentationPublic: true,
              forkedFromPageId: true,
              forkedFromAuthorId: true,
              forkedAt: true,
              createdAt: true,
              updatedAt: true,
            }
          }
        }
      })

      if (!skript) return null

      const page = skript.pages.find(p => p.slug === contentPageSlug)
      if (!page) return null

      // Get collection info for sidebar structure
      const collectionSkript = skript.collectionSkripts[0]
      const collection = collectionSkript?.collection

      return {
        collection: collection ? {
          id: collection.id,
          title: collection.title,
          accentColor: collection.accentColor,
        } : null,
        skript: {
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          isPublished: skript.isPublished,
          order: collectionSkript?.order ?? 0,
        },
        page,
        allPages: skript.pages,
      }
    },
    [`published-page-${teacherId}-${skriptSlug}-${contentPageSlug}`],
    {
      tags: ownerPageSlug ? [
        CACHE_TAGS.pageBySlug(ownerPageSlug, skriptSlug, contentPageSlug),
        CACHE_TAGS.skriptBySlug(ownerPageSlug, skriptSlug),
        CACHE_TAGS.teacherContent(ownerPageSlug),
      ] : [],
      revalidate: false,
    }
  )()

/**
 * React cache wrapper for request deduplication
 * Use this for queries that might be called multiple times in the same request
 */
export const getTeacherByPageSlugDeduped = cache((pageSlug: string) => {
  return getTeacherByPageSlug(pageSlug)
})

// Backwards-compatible alias
export const getTeacherByUsernameDeduped = getTeacherByPageSlugDeduped

/**
 * Get teacher's homepage content - cached
 * Fetches collections and skripts based on page layout
 */
export const getTeacherHomepageContent = (teacherId: string, pageSlug: string, pageLayoutItems: Array<{ type: string; contentId: string }>) =>
  unstable_cache(
    async () => {
      const collections: Array<{
        id: string
        title: string
        accentColor: string | null
        skripts: Array<{
          id: string
          title: string
          slug: string
          pages: Array<{ id: string; title: string; slug: string }>
        }>
      }> = []

      const rootSkripts: Array<{
        id: string
        title: string
        description: string | null
        slug: string
        collection: { title: string }
        pages: Array<{ id: string; title: string; slug: string }>
      }> = []

      const collectionIds = pageLayoutItems.filter(i => i.type === 'collection').map(i => i.contentId)
      const skriptIds = pageLayoutItems.filter(i => i.type === 'skript').map(i => i.contentId)

      const [fetchedCollections, fetchedSkripts] = await Promise.all([
        collectionIds.length
          ? prisma.collection.findMany({
              where: {
                id: { in: collectionIds },
                site: { userId: teacherId }
              },
              include: {
                collectionSkripts: {
                  where: { skript: { isPublished: true, isUnlisted: false } },
                  include: {
                    skript: {
                      include: {
                        frontPage: { select: { id: true } },
                        pages: {
                          where: { isPublished: true, isUnlisted: false },
                          orderBy: { order: 'asc' },
                          select: { id: true, title: true, slug: true }
                        }
                      }
                    }
                  },
                  orderBy: { order: 'asc' }
                }
              }
            })
          : [],
        skriptIds.length
          ? prisma.skript.findMany({
              where: {
                id: { in: skriptIds },
                isPublished: true,
                authors: { some: { userId: teacherId } }
              },
              include: {
                collectionSkripts: { include: { collection: true } },
                pages: {
                  where: { isPublished: true, isUnlisted: false },
                  orderBy: { order: 'asc' },
                  select: { id: true, title: true, slug: true }
                }
              }
            })
          : [],
      ])

      const collectionById = new Map(fetchedCollections.map(c => [c.id, c]))
      const skriptById = new Map(fetchedSkripts.map(s => [s.id, s]))

      for (const item of pageLayoutItems) {
        if (item.type === 'collection') {
          const collection = collectionById.get(item.contentId)
          if (!collection) continue
          collections.push({
            id: collection.id,
            title: collection.title,
            accentColor: collection.accentColor,
            skripts: collection.collectionSkripts.map((cs, index) => ({
              id: cs.skript.id,
              title: cs.skript.title,
              slug: cs.skript.slug,
              order: cs.order ?? index,
              pages: cs.skript.pages
            }))
          })
        } else if (item.type === 'skript') {
          const skript = skriptById.get(item.contentId)
          if (!skript) continue
          const firstCollection = skript.collectionSkripts[0]?.collection
          rootSkripts.push({
            id: skript.id,
            title: skript.title,
            description: skript.description,
            slug: skript.slug,
            collection: firstCollection
              ? { title: firstCollection.title }
              : { title: 'Uncategorized' },
            pages: skript.pages
          })
        }
      }

      return { collections, rootSkripts }
    },
    [`teacher-homepage-${pageSlug}`],
    {
      tags: [CACHE_TAGS.teacherContent(pageSlug)],
      revalidate: false,
    }
  )()

/**
 * Get skript for preview (including unpublished) by unique slug.
 * NOT cached - used for preview mode.
 * Verifies teacher authorship via skript or collection authors.
 */
export const getSkriptForPreview = async (teacherId: string, skriptSlug: string) => {
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      OR: [
        { authors: { some: { userId: teacherId } } },
        { collectionSkripts: { some: { collection: { site: { userId: teacherId } } } } }
      ]
    },
    include: {
      collectionSkripts: {
        include: {
          collection: true
        },
        orderBy: { order: 'asc' },
        take: 1,
      },
      frontPage: { select: { id: true } },
      pages: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          order: true,
          isPublished: true,
          pageType: true,
          examSettings: true,
        }
      }
    }
  })

  if (!skript) return null

  return skript
}

// ============================================
// Organization cached queries
// ============================================

/**
 * Get organization with page layout - cached
 * Used for org public pages
 */
export const getOrgWithLayout = (slug: string) =>
  unstable_cache(
    async () => {
      // URL slug lives on Site. Look up the site by slug, then return the
      // attached organization with pageLayout/frontPage grafted under their
      // legacy field names so consumers don't need to be touched.
      const site = await prisma.site.findUnique({
        where: { slug },
        include: {
          organization: {
            include: {
              _count: { select: { members: true } },
            },
          },
          frontPage: true,
          pageLayout: {
            include: {
              items: { orderBy: { order: 'asc' } }
            }
          }
        }
      })
      if (!site?.organization) return null
      // Graft slug + all page-display fields onto the org so consumers
      // can keep reading `org.description`, `org.iconUrl`, etc. without
      // a sweep. Map Site.pageIcon → org.iconUrl / Site.pageDescription
      // → org.description for the legacy field names.
      const extra = readExtraSettings(site)
      return Object.assign(site.organization, {
        slug: site.slug,
        description: site.pageDescription,
        iconUrl: site.pageIcon,
        showIcon: site.showIcon,
        pageLanguage: site.pageLanguage,
        pageTagline: site.pageTagline,
        sidebarBehavior: site.sidebarBehavior,
        aiSystemPrompt: site.aiSystemPrompt,
        titleStyle: extra.titleStyle ?? 'icon',
        logoUrl: extra.logoUrl ?? null,
        pageLayout: site.pageLayout ?? null,
        frontPage: site.frontPage ?? null,
      })
    },
    [`org-layout-${slug}`],
    {
      tags: [CACHE_TAGS.organization(slug), CACHE_TAGS.orgContent(slug)],
      revalidate: false,
    }
  )()

/**
 * Get org's full site structure for sidebar navigation - cached
 * Fetches all published collections from org's page layout
 */
export const getOrgFullSiteStructure = (orgId: string, orgSlug: string) =>
  unstable_cache(
    async (): Promise<SiteStructure[]> => {
      // Get all admin/owner user IDs for this org
      const adminMembers = await prisma.organizationMember.findMany({
        where: {
          organizationId: orgId,
          role: { in: ['owner', 'admin'] }
        },
        select: { userId: true }
      })
      const adminUserIds = adminMembers.map(m => m.userId)

      if (adminUserIds.length === 0) {
        return []
      }

      // Fetch org page layout (now in the unified PageLayout table keyed by
      // siteId) to determine collection order.
      const pageLayout = await prisma.pageLayout.findFirst({
        where: { site: { organizationId: orgId } },
        include: {
          items: {
            where: { type: 'collection' },
            orderBy: { order: 'asc' }
          }
        }
      })

      const layoutCollectionIds = pageLayout?.items.map(item => item.contentId) || []

      if (layoutCollectionIds.length === 0) {
        return []
      }

      const collections = await prisma.collection.findMany({
        where: {
          id: { in: layoutCollectionIds },
          // Org pageLayout references collections owned by the org's site OR
          // collections owned by an admin's personal site (mirrors the legacy
          // "any admin author" gating). Mix should be rare but is permitted.
          OR: [
            { site: { organizationId: orgId } },
            { site: { userId: { in: adminUserIds } } },
          ],
        },
        select: {
          id: true,
          title: true,
          accentColor: true,
          updatedAt: true,
          collectionSkripts: {
            where: {
              skript: { isPublished: true, isUnlisted: false }
            },
            include: {
              skript: {
                include: {
                  frontPage: { select: { id: true } },
                  pages: {
                    where: { isPublished: true, isUnlisted: false },
                    orderBy: { order: 'asc' },
                    select: {
                      id: true,
                      title: true,
                      slug: true,
                      isPublished: true,
                      order: true
                    }
                  }
                }
              }
            },
            orderBy: { order: 'asc' }
          }
        }
      })

      // Sort collections by page layout order
      const sortedCollections = [...collections].sort((a, b) => {
        const aIndex = layoutCollectionIds.indexOf(a.id)
        const bIndex = layoutCollectionIds.indexOf(b.id)
        return aIndex - bIndex
      })

      return buildSiteStructure(sortedCollections, { onlyPublished: true })
    },
    [`org-full-site-structure-${orgSlug}`],
    {
      tags: [CACHE_TAGS.organization(orgSlug), CACHE_TAGS.orgContent(orgSlug)],
      revalidate: false,
    }
  )()

/**
 * Get org's homepage content - cached
 * Fetches collections and skripts based on org page layout
 * Content is fetched based on what org admins have access to
 */
/**
 * Get published page content for an organization - cached
 * Looks up content owned by any org admin/owner
 */
/**
 * Get published page content for an organization - cached.
 * Queries skript directly by unique slug (no collection needed in URL).
 * Verifies the skript's collection is in the org's page layout.
 */
export const getOrgPublishedPage = (
  orgId: string,
  slug: string,
  skriptSlug: string,
  pageSlug: string
) =>
  unstable_cache(
    async () => {
      // Get all admin/owner user IDs for this org
      const adminMembers = await prisma.organizationMember.findMany({
        where: {
          organizationId: orgId,
          role: { in: ['owner', 'admin'] }
        },
        select: { userId: true }
      })
      const adminUserIds = adminMembers.map(m => m.userId)

      // Find skript by slug scoped to org admins
      const skript = await prisma.skript.findFirst({
        where: {
          slug: skriptSlug,
          isPublished: true,
          OR: [
            { authors: { some: { userId: { in: adminUserIds } } } },
            { collectionSkripts: { some: { collection: { site: { organizationId: orgId } } } } },
            { collectionSkripts: { some: { collection: { site: { userId: { in: adminUserIds } } } } } },
          ]
        },
        include: {
          collectionSkripts: {
            include: {
              collection: true
            },
            orderBy: { order: 'asc' },
          },
          pages: {
            where: { isPublished: true },
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              slug: true,
              description: true,
              content: true,
              order: true,
              isPublished: true,
              isUnlisted: true,
              pageType: true,
              examSettings: true,
              createdAt: true,
              updatedAt: true,
            }
          }
        }
      })

      if (!skript) return null

      // The skript has to be reachable from the org's home page — either as a
      // root skript pinned directly in the org's page layout, or via a
      // collection that's in the layout. A skript can be both "in a collection"
      // AND "pinned at root", and can belong to MULTIPLE collections (e.g. also
      // filed under an "Organisatorisches" collection that isn't in the layout).
      // Check ALL memberships: the previous take:1 fetched only the order-first
      // membership and 404'd skripts reachable via a different collection.
      const orgPageLayout = await prisma.pageLayout.findFirst({
        where: { site: { organizationId: orgId } },
        include: {
          items: { where: { type: { in: ['collection', 'skript'] } } }
        }
      })
      if (!orgPageLayout) return null
      const layoutCollectionIds = new Set(
        orgPageLayout.items.filter(i => i.type === 'collection').map(i => i.contentId)
      )
      const layoutSkriptIds = new Set(
        orgPageLayout.items.filter(i => i.type === 'skript').map(i => i.contentId)
      )
      // Prefer the membership whose collection is in the org nav (drives the
      // breadcrumb/structure); fall back to the first membership for display.
      const collectionSkript =
        skript.collectionSkripts.find(cs => layoutCollectionIds.has(cs.collection.id))
        ?? skript.collectionSkripts[0]
      const reachableViaCollection = skript.collectionSkripts.some(
        cs => layoutCollectionIds.has(cs.collection.id)
      )
      const reachableAsRootSkript = layoutSkriptIds.has(skript.id)
      if (!reachableViaCollection && !reachableAsRootSkript) {
        return null
      }

      const page = skript.pages.find(p => p.slug === pageSlug)
      if (!page) return null

      const collection = collectionSkript?.collection

      return {
        collection: collection ? {
          id: collection.id,
          title: collection.title,
          accentColor: collection.accentColor,
        } : null,
        skript: {
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          isPublished: skript.isPublished,
          order: collectionSkript?.order ?? 0,
        },
        page,
        allPages: skript.pages,
      }
    },
    [`org-published-page-${slug}-${skriptSlug}-${pageSlug}`],
    {
      tags: [CACHE_TAGS.orgContent(slug)],
      revalidate: false,
    }
  )()

export const getOrgHomepageContent = (
  orgId: string,
  slug: string,
  pageLayoutItems: Array<{ type: string; contentId: string }>
) =>
  unstable_cache(
    async () => {
      // Get all admin/owner user IDs for this org
      const adminMembers = await prisma.organizationMember.findMany({
        where: {
          organizationId: orgId,
          role: { in: ['owner', 'admin'] }
        },
        select: { userId: true }
      })
      const adminUserIds = adminMembers.map(m => m.userId)

      const collections: Array<{
        id: string
        title: string
        accentColor: string | null
        skripts: Array<{
          id: string
          title: string
          slug: string
          pages: Array<{ id: string; title: string; slug: string }>
        }>
      }> = []

      const rootSkripts: Array<{
        id: string
        title: string
        description: string | null
        slug: string
        collection: { title: string }
        pages: Array<{ id: string; title: string; slug: string }>
      }> = []

      const collectionIds = pageLayoutItems.filter(i => i.type === 'collection').map(i => i.contentId)
      const skriptIds = pageLayoutItems.filter(i => i.type === 'skript').map(i => i.contentId)

      const [fetchedCollections, fetchedSkripts] = await Promise.all([
        collectionIds.length
          ? prisma.collection.findMany({
              where: {
                id: { in: collectionIds },
                OR: [
                  { site: { organizationId: orgId } },
                  { site: { userId: { in: adminUserIds } } },
                ],
              },
              include: {
                collectionSkripts: {
                  where: { skript: { isPublished: true, isUnlisted: false } },
                  include: {
                    skript: {
                      include: {
                        frontPage: { select: { id: true } },
                        pages: {
                          where: { isPublished: true, isUnlisted: false },
                          orderBy: { order: 'asc' },
                          select: { id: true, title: true, slug: true }
                        }
                      }
                    }
                  },
                  orderBy: { order: 'asc' }
                }
              }
            })
          : [],
        skriptIds.length
          ? prisma.skript.findMany({
              where: {
                id: { in: skriptIds },
                isPublished: true,
                OR: [
                  { authors: { some: { userId: { in: adminUserIds } } } },
                  { collectionSkripts: { some: { collection: { site: { organizationId: orgId } } } } },
                ],
              },
              include: {
                collectionSkripts: { include: { collection: true } },
                pages: {
                  where: { isPublished: true, isUnlisted: false },
                  orderBy: { order: 'asc' },
                  select: { id: true, title: true, slug: true }
                }
              }
            })
          : [],
      ])

      const collectionById = new Map(fetchedCollections.map(c => [c.id, c]))
      const skriptById = new Map(fetchedSkripts.map(s => [s.id, s]))

      for (const item of pageLayoutItems) {
        if (item.type === 'collection') {
          const collection = collectionById.get(item.contentId)
          if (!collection) continue
          collections.push({
            id: collection.id,
            title: collection.title,
            accentColor: collection.accentColor,
            skripts: collection.collectionSkripts.map((cs, index) => ({
              id: cs.skript.id,
              title: cs.skript.title,
              slug: cs.skript.slug,
              order: cs.order ?? index,
              pages: cs.skript.pages
            }))
          })
        } else if (item.type === 'skript') {
          const skript = skriptById.get(item.contentId)
          if (!skript) continue
          const firstCollection = skript.collectionSkripts[0]?.collection
          rootSkripts.push({
            id: skript.id,
            title: skript.title,
            description: skript.description,
            slug: skript.slug,
            collection: firstCollection
              ? { title: firstCollection.title }
              : { title: 'Uncategorized' },
            pages: skript.pages
          })
        }
      }

      return { collections, rootSkripts }
    },
    [`org-homepage-${slug}`],
    {
      tags: [CACHE_TAGS.orgContent(slug)],
      revalidate: false,
    }
  )()

/**
 * The three lookups behind /org/[orgSlug]/[pageSlug]/[skriptSlug]/[contentPageSlug]
 * — a teacher's page served under an org host (every eduskript.org teacher URL).
 *
 * That route is `force-dynamic` and ran these uncached, twice per request
 * (generateMetadata + the component), measured at 11 DB queries per page view
 * against 0 for the same page on a custom domain, which is served by the ISR
 * `[domain]` tree. Both callers share this one cached entry.
 *
 * The where-clauses match what the route did before, deliberately: unlike
 * getPublishedPage() this does NOT require skript.isPublished or
 * page.isPublished, so the org route keeps serving unpublished content exactly
 * as it did. That inconsistency with the [domain] route is pre-existing and
 * worth deciding on separately — do not "fix" it here by accident.
 *
 * Tag set is a superset of what page/skript/collection saves invalidate
 * (teacherContent + orgContent), so edits show up without a deploy.
 */
export const getOrgTeacherContentPage = (
  orgSlug: string,
  pageSlug: string,
  skriptSlug: string,
  contentPageSlug: string
) =>
  unstable_cache(
    async () => {
      log('MISS getOrgTeacherContentPage', { orgSlug, pageSlug, skriptSlug, contentPageSlug })

      const orgSite = await prisma.site.findUnique({
        where: { slug: orgSlug },
        select: {
          pageLanguage: true,
          pageDescription: true,
          pageIcon: true,
          showIcon: true,
          organization: { select: { id: true, name: true } },
        },
      })
      if (!orgSite?.organization) return null

      const teacher = await prisma.user.findFirst({
        where: {
          sites: { some: { slug: pageSlug } },
          organizationMemberships: { some: { organizationId: orgSite.organization.id } },
        },
        select: {
          id: true,
          name: true,
          bio: true,
          title: true,
          sites: {
            where: { slug: pageSlug },
            take: 1,
            select: {
              slug: true,
              pageName: true,
              pageDescription: true,
              pageIcon: true,
              sidebarBehavior: true,
              typographyPreference: true,
              extraSettings: true,
            },
          },
        },
      })
      if (!teacher) return null

      const page = await prisma.page.findFirst({
        where: {
          slug: contentPageSlug,
          skript: {
            slug: skriptSlug,
            OR: [
              { authors: { some: { userId: teacher.id } } },
              { collectionSkripts: { some: { collection: { site: { userId: teacher.id } } } } },
            ],
          },
        },
        include: {
          skript: {
            include: {
              collectionSkripts: {
                include: { collection: true },
                orderBy: { order: 'asc' },
                take: 1,
              },
              pages: {
                where: { isPublished: true },
                orderBy: { order: 'asc' },
                select: { id: true, title: true, slug: true },
              },
            },
          },
        },
      })
      if (!page) return null

      return {
        orgSite: {
          pageLanguage: orgSite.pageLanguage,
          pageDescription: orgSite.pageDescription,
          pageIcon: orgSite.pageIcon,
          showIcon: orgSite.showIcon,
        },
        organization: orgSite.organization,
        teacher,
        page,
      }
    },
    [`org-teacher-page-${orgSlug}-${pageSlug}-${skriptSlug}-${contentPageSlug}`],
    {
      tags: [
        CACHE_TAGS.organization(orgSlug),
        CACHE_TAGS.orgContent(orgSlug),
        CACHE_TAGS.user(pageSlug),
        CACHE_TAGS.teacherContent(pageSlug),
        CACHE_TAGS.skriptBySlug(pageSlug, skriptSlug),
        CACHE_TAGS.pageBySlug(pageSlug, skriptSlug, contentPageSlug),
      ],
      revalidate: false,
    }
  )()

/**
 * Org + teacher + skript for /org/[orgSlug]/[pageSlug]/[skriptSlug] — the
 * skript front page under an org host. Same story as
 * getOrgTeacherContentPage: force-dynamic route, three lookups run twice per
 * request (generateMetadata + component), measured at 6 queries per request
 * even on repeat views. Next prefetches these from every sidebar link, so they
 * fire constantly while a reader browses.
 *
 * Where-clauses preserved exactly as the route had them, including the absence
 * of an isPublished filter on the skript.
 */
export const getOrgTeacherSkript = (
  orgSlug: string,
  pageSlug: string,
  skriptSlug: string
) =>
  unstable_cache(
    async () => {
      log('MISS getOrgTeacherSkript', { orgSlug, pageSlug, skriptSlug })

      const orgSite = await prisma.site.findUnique({
        where: { slug: orgSlug },
        select: {
          pageDescription: true,
          pageIcon: true,
          showIcon: true,
          organization: { select: { id: true, name: true } },
        },
      })
      if (!orgSite?.organization) return null

      const teacher = await prisma.user.findFirst({
        where: {
          sites: { some: { slug: pageSlug } },
          organizationMemberships: { some: { organizationId: orgSite.organization.id } },
        },
        select: {
          id: true,
          name: true,
          bio: true,
          title: true,
          sites: {
            where: { slug: pageSlug },
            take: 1,
            select: {
              slug: true,
              pageName: true,
              pageDescription: true,
              pageIcon: true,
              sidebarBehavior: true,
              typographyPreference: true,
              extraSettings: true,
            },
          },
        },
      })
      if (!teacher) return null

      const skript = await prisma.skript.findFirst({
        where: {
          slug: skriptSlug,
          OR: [
            { authors: { some: { userId: teacher.id } } },
            { collectionSkripts: { some: { collection: { site: { userId: teacher.id } } } } },
          ],
        },
        include: {
          frontPage: true,
          collectionSkripts: {
            include: { collection: true },
            orderBy: { order: 'asc' },
            take: 1,
          },
          pages: {
            where: { isPublished: true },
            orderBy: { order: 'asc' },
            select: { id: true, title: true, slug: true },
          },
        },
      })
      if (!skript) return null

      return {
        orgSite: {
          pageDescription: orgSite.pageDescription,
          pageIcon: orgSite.pageIcon,
          showIcon: orgSite.showIcon,
        },
        organization: orgSite.organization,
        teacher,
        skript,
      }
    },
    [`org-teacher-skript-${orgSlug}-${pageSlug}-${skriptSlug}`],
    {
      tags: [
        CACHE_TAGS.organization(orgSlug),
        CACHE_TAGS.orgContent(orgSlug),
        CACHE_TAGS.user(pageSlug),
        CACHE_TAGS.teacherContent(pageSlug),
        CACHE_TAGS.skriptBySlug(pageSlug, skriptSlug),
      ],
      revalidate: false,
    }
  )()

/**
 * Resolve a custom domain to the org or teacher site it serves — cached.
 *
 * Called by /api/internal/resolve-domain, which the proxy hits whenever its
 * own 15-minute in-process map misses (src/proxy.ts). Uncached, that was two
 * Prisma queries per miss, and since the managed Postgres sleeps only after 5
 * minutes without a connection, a domain with steady traffic re-woke it every
 * quarter of an hour. Cached and tagged per domain it costs nothing until the
 * domain actually changes.
 *
 * Invalidate with revalidateTag(CACHE_TAGS.customDomain(domain)) wherever a
 * domain row is verified, deleted or re-pointed (see src/lib/domain-cache.ts).
 */
export type ResolvedDomain =
  | { type: 'org'; orgId: string; orgSlug: string; orgName: string; isPrimary: boolean }
  | { type: 'teacher'; userId: string; pageSlug: string | null; userName: string | null; isPrimary: boolean }
  | null

export const resolveCustomDomain = (domain: string) =>
  unstable_cache(
    async (): Promise<ResolvedDomain> => {
      log('MISS resolveCustomDomain', { domain })

      // Organization domains win over teacher domains, as before.
      const orgDomain = await prisma.customDomain.findFirst({
        where: { domain, isVerified: true },
        include: {
          organization: {
            select: { id: true, name: true, site: { select: { slug: true } } },
          },
        },
      })

      if (orgDomain) {
        return {
          type: 'org',
          orgId: orgDomain.organization.id,
          orgSlug: orgDomain.organization.site?.slug ?? '',
          orgName: orgDomain.organization.name,
          isPrimary: orgDomain.isPrimary,
        }
      }

      // Teacher domains point at a specific Site; legacy rows without a siteId
      // fall back to the user's primary site.
      const teacherDomain = await prisma.teacherCustomDomain.findFirst({
        where: { domain, isVerified: true },
        include: {
          site: { select: { slug: true } },
          user: {
            select: {
              id: true,
              name: true,
              sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true } },
            },
          },
        },
      })

      if (teacherDomain) {
        return {
          type: 'teacher',
          userId: teacherDomain.user.id,
          pageSlug: teacherDomain.site?.slug ?? teacherDomain.user.sites[0]?.slug ?? null,
          userName: teacherDomain.user.name,
          isPrimary: teacherDomain.isPrimary,
        }
      }

      return null
    },
    [`resolve-domain-${domain}`],
    {
      tags: [CACHE_TAGS.customDomain(domain), 'custom-domains'],
      revalidate: false,
    }
  )()
