import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { prisma } from './prisma'
import { buildSiteStructure, type SiteStructure } from './site-structure'
import { createLogger } from './logger'

const log = createLogger('cache:queries')

// Cache tags for granular invalidation
// Note: pageSlug is the URL slug for a user's public page (e.g., eduskript.org/mypage)
export const CACHE_TAGS = {
  user: (pageSlug: string) => `user:${pageSlug}`,
  collection: (id: string) => `collection:${id}`,
  collectionBySlug: (pageSlug: string, slug: string) => `collection:${pageSlug}:${slug}`,
  skript: (id: string) => `skript:${id}`,
  skriptBySlug: (pageSlug: string, skriptSlug: string) =>
    `skript:${pageSlug}:${skriptSlug}`,
  page: (id: string) => `page:${id}`,
  pageBySlug: (pageSlugParam: string, skriptSlug: string, pageSlug: string) =>
    `page:${pageSlugParam}:${skriptSlug}:${pageSlug}`,
  teacherContent: (pageSlug: string) => `teacher-content:${pageSlug}`,
  organization: (slug: string) => `org:${slug}`,
  orgContent: (slug: string) => `org-content:${slug}`,
} as const

/**
 * Get teacher by page slug - cached
 * Used for public page rendering
 */
export const getTeacherByPageSlug = (pageSlug: string) =>
  unstable_cache(
    async () => {
      log('MISS getTeacherByPageSlug', { pageSlug })
      return prisma.user.findFirst({
        where: { pageSlug },
        select: {
          id: true,
          name: true,
          email: true,
          pageSlug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          pageLanguage: true,
          pageTagline: true,
          title: true,
          bio: true,
          sidebarBehavior: true,
          typographyPreference: true,
          customDomains: {
            where: { isVerified: true, isPrimary: true },
            select: { domain: true },
            take: 1,
          },
        }
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
      return prisma.user.findFirst({
        where: { pageSlug },
        include: {
          pageLayout: {
            include: {
              items: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      })
    },
    [`teacher-layout-${pageSlug}`],
    {
      tags: [CACHE_TAGS.user(pageSlug), CACHE_TAGS.teacherContent(pageSlug)],
      revalidate: false,
    }
  )()

/**
 * Get published collection with skripts and pages - cached
 * Only returns published content for public consumption
 */
export const getPublishedCollection = (teacherId: string, pageSlug: string, collectionSlug: string) =>
  unstable_cache(
    async () => {
      return prisma.collection.findFirst({
        where: {
          slug: collectionSlug,
          authors: {
            some: { userId: teacherId }
          }
        },
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
                      slug: true,
                      content: true,
                      order: true,
                      isPublished: true,
                      pageType: true,
                      examSettings: true,
                    }
                  }
                }
              }
            },
            orderBy: { order: 'asc' }
          }
        }
      })
    },
    [`published-collection-${pageSlug}-${collectionSlug}`],
    {
      tags: [
        CACHE_TAGS.collectionBySlug(pageSlug, collectionSlug),
        CACHE_TAGS.teacherContent(pageSlug),
      ],
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
        where: {
          authors: {
            some: { userId: teacherId }
          }
        },
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
      // Fetch page layout to determine collection order
      const pageLayout = await prisma.pageLayout.findFirst({
        where: {
          user: { pageSlug }
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
          authors: { some: { userId: teacherId } },
        },
        select: {
          id: true,
          title: true,
          slug: true,
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
            { collectionSkripts: { some: { collection: { authors: { some: { userId: teacherId } } } } } }
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
              content: true,
              order: true,
              isPublished: true,
              isUnlisted: true,
              pageType: true,
              examSettings: true,
              forkedFromPageId: true,
              forkedFromAuthorId: true,
              forkedAt: true,
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
          slug: collection.slug,
          description: collection.description,
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
        slug: string
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
        collection: { title: string; slug: string }
        pages: Array<{ id: string; title: string; slug: string }>
      }> = []

      for (const item of pageLayoutItems) {
        if (item.type === 'collection') {
          const collection = await prisma.collection.findFirst({
            where: {
              id: item.contentId,
              authors: { some: { userId: teacherId } }
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
          if (collection) {
            collections.push({
              id: collection.id,
              title: collection.title,
              slug: collection.slug,
              accentColor: collection.accentColor,
              skripts: collection.collectionSkripts.map((cs, index) => ({
                id: cs.skript.id,
                title: cs.skript.title,
                slug: cs.skript.slug,
                order: cs.order ?? index,
                pages: cs.skript.pages
              }))
            })
          }
        } else if (item.type === 'skript') {
          const skript = await prisma.skript.findFirst({
            where: {
              id: item.contentId,
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
          if (skript) {
            const firstCollection = skript.collectionSkripts[0]?.collection
            rootSkripts.push({
              id: skript.id,
              title: skript.title,
              description: skript.description,
              slug: skript.slug,
              collection: firstCollection || { title: 'Uncategorized', slug: 'uncategorized' },
              pages: skript.pages
            })
          }
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
 * Get collection for any user (including unpublished for authors)
 * NOT cached - used for preview mode
 */
export const getCollectionForPreview = async (teacherId: string, collectionSlug: string) => {
  return prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: {
        some: { userId: teacherId }
      }
    },
    include: {
      collectionSkripts: {
        include: {
          skript: {
            include: {
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
          }
        },
        orderBy: { order: 'asc' }
      }
    }
  })
}

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
        { collectionSkripts: { some: { collection: { authors: { some: { userId: teacherId } } } } } }
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
      return prisma.organization.findUnique({
        where: { slug },
        include: {
          frontPage: true,
          pageLayout: {
            include: {
              items: {
                orderBy: { order: 'asc' }
              }
            }
          },
          _count: {
            select: { members: true }
          }
        }
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

      // Fetch org page layout to determine collection order
      const pageLayout = await prisma.orgPageLayout.findFirst({
        where: { organizationId: orgId },
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
          authors: { some: { userId: { in: adminUserIds } } }
        },
        select: {
          id: true,
          title: true,
          slug: true,
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
            { collectionSkripts: { some: { collection: { authors: { some: { userId: { in: adminUserIds } } } } } } }
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
              content: true,
              order: true,
              isPublished: true,
              isUnlisted: true,
              pageType: true,
              examSettings: true,
            }
          }
        }
      })

      if (!skript) return null

      // Verify the skript's collection is in the org's page layout
      const collectionSkript = skript.collectionSkripts[0]
      if (collectionSkript?.collection) {
        const orgPageLayout = await prisma.orgPageLayout.findUnique({
          where: { organizationId: orgId },
          include: {
            items: { where: { type: 'collection' } }
          }
        })
        if (!orgPageLayout) return null
        const configuredCollectionIds = orgPageLayout.items.map(item => item.contentId)
        if (!configuredCollectionIds.includes(collectionSkript.collection.id)) {
          return null
        }
      }

      const page = skript.pages.find(p => p.slug === pageSlug)
      if (!page) return null

      const collection = collectionSkript?.collection

      return {
        collection: collection ? {
          id: collection.id,
          title: collection.title,
          slug: collection.slug,
          description: collection.description,
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
        slug: string
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
        collection: { title: string; slug: string }
        pages: Array<{ id: string; title: string; slug: string }>
      }> = []

      for (const item of pageLayoutItems) {
        if (item.type === 'collection') {
          const collection = await prisma.collection.findFirst({
            where: {
              id: item.contentId,
              authors: { some: { userId: { in: adminUserIds } } }
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
          if (collection) {
            collections.push({
              id: collection.id,
              title: collection.title,
              slug: collection.slug,
              accentColor: collection.accentColor,
              skripts: collection.collectionSkripts.map((cs, index) => ({
                id: cs.skript.id,
                title: cs.skript.title,
                slug: cs.skript.slug,
                order: cs.order ?? index,
                pages: cs.skript.pages
              }))
            })
          }
        } else if (item.type === 'skript') {
          const skript = await prisma.skript.findFirst({
            where: {
              id: item.contentId,
              isPublished: true,
              authors: { some: { userId: { in: adminUserIds } } }
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
          if (skript) {
            const firstCollection = skript.collectionSkripts[0]?.collection
            rootSkripts.push({
              id: skript.id,
              title: skript.title,
              description: skript.description,
              slug: skript.slug,
              collection: firstCollection || { title: 'Uncategorized', slug: 'uncategorized' },
              pages: skript.pages
            })
          }
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
