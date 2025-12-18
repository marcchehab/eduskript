import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { prisma } from './prisma'

// Cache tags for granular invalidation
// Note: pageSlug is the URL slug for a user's public page (e.g., eduskript.org/mypage)
export const CACHE_TAGS = {
  user: (pageSlug: string) => `user:${pageSlug}`,
  collection: (id: string) => `collection:${id}`,
  collectionBySlug: (pageSlug: string, slug: string) => `collection:${pageSlug}:${slug}`,
  skript: (id: string) => `skript:${id}`,
  skriptBySlug: (pageSlug: string, collectionSlug: string, skriptSlug: string) =>
    `skript:${pageSlug}:${collectionSlug}:${skriptSlug}`,
  page: (id: string) => `page:${id}`,
  pageBySlug: (pageSlugParam: string, collectionSlug: string, skriptSlug: string, pageSlug: string) =>
    `page:${pageSlugParam}:${collectionSlug}:${skriptSlug}:${pageSlug}`,
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
          title: true,
          bio: true,
          sidebarBehavior: true,
          typographyPreference: true,
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
          isPublished: true,
          authors: {
            some: { userId: teacherId }
          }
        },
        include: {
          collectionSkripts: {
            where: {
              skript: { isPublished: true }
            },
            include: {
              skript: {
                include: {
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
          },
          isPublished: true
        },
        include: {
          collectionSkripts: {
            where: {
              skript: { isPublished: true }
            },
            include: {
              skript: {
                include: {
                  pages: {
                    where: { isPublished: true },
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
 * Get published page content - cached
 * The main content fetch for public pages
 */
export const getPublishedPage = (
  teacherId: string,
  collectionSlug: string,
  skriptSlug: string,
  contentPageSlug: string,
  ownerPageSlug?: string
) =>
  unstable_cache(
    async () => {
      const collection = await prisma.collection.findFirst({
        where: {
          slug: collectionSlug,
          isPublished: true,
          authors: {
            some: { userId: teacherId }
          }
        },
        include: {
          collectionSkripts: {
            where: {
              skript: {
                slug: skriptSlug,
                isPublished: true
              }
            },
            include: {
              skript: {
                include: {
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

      if (!collection) return null

      const collectionSkript = collection.collectionSkripts[0]
      if (!collectionSkript) return null

      const skript = collectionSkript.skript
      const page = skript.pages.find(p => p.slug === contentPageSlug)
      if (!page) return null

      return {
        collection: {
          id: collection.id,
          title: collection.title,
          slug: collection.slug,
          description: collection.description,
          isPublished: collection.isPublished,
        },
        skript: {
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          isPublished: skript.isPublished,
        },
        page,
        // Include all pages for navigation
        allPages: skript.pages,
      }
    },
    [`published-page-${collectionSlug}-${skriptSlug}-${contentPageSlug}`],
    {
      tags: ownerPageSlug ? [
        CACHE_TAGS.pageBySlug(ownerPageSlug, collectionSlug, skriptSlug, contentPageSlug),
        CACHE_TAGS.skriptBySlug(ownerPageSlug, collectionSlug, skriptSlug),
        CACHE_TAGS.collectionBySlug(ownerPageSlug, collectionSlug),
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
              isPublished: true,
              authors: { some: { userId: teacherId } }
            },
            include: {
              collectionSkripts: {
                where: { skript: { isPublished: true } },
                include: {
                  skript: {
                    include: {
                      pages: {
                        where: { isPublished: true },
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
              skripts: collection.collectionSkripts.map(cs => ({
                id: cs.skript.id,
                title: cs.skript.title,
                slug: cs.skript.slug,
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
                where: { isPublished: true },
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
 * Get org's homepage content - cached
 * Fetches collections and skripts based on org page layout
 * Content is fetched based on what org admins have access to
 */
/**
 * Get published page content for an organization - cached
 * Looks up content owned by any org admin/owner
 */
export const getOrgPublishedPage = (
  orgId: string,
  slug: string,
  collectionSlug: string,
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

      const collection = await prisma.collection.findFirst({
        where: {
          slug: collectionSlug,
          isPublished: true,
          authors: {
            some: { userId: { in: adminUserIds } }
          }
        },
        include: {
          collectionSkripts: {
            where: {
              skript: {
                slug: skriptSlug,
                isPublished: true
              }
            },
            include: {
              skript: {
                include: {
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

      if (!collection) return null

      const collectionSkript = collection.collectionSkripts[0]
      if (!collectionSkript) return null

      const skript = collectionSkript.skript
      const page = skript.pages.find(p => p.slug === pageSlug)
      if (!page) return null

      return {
        collection: {
          id: collection.id,
          title: collection.title,
          slug: collection.slug,
          description: collection.description,
          isPublished: collection.isPublished,
        },
        skript: {
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          isPublished: skript.isPublished,
        },
        page,
        allPages: skript.pages,
      }
    },
    [`org-published-page-${slug}-${collectionSlug}-${skriptSlug}-${pageSlug}`],
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
              isPublished: true,
              authors: { some: { userId: { in: adminUserIds } } }
            },
            include: {
              collectionSkripts: {
                where: { skript: { isPublished: true } },
                include: {
                  skript: {
                    include: {
                      pages: {
                        where: { isPublished: true },
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
              skripts: collection.collectionSkripts.map(cs => ({
                id: cs.skript.id,
                title: cs.skript.title,
                slug: cs.skript.slug,
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
                where: { isPublished: true },
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
