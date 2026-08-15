import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { FrontpageOwnerCta } from '@/components/public/frontpage-owner-cta'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { getFullSiteStructure } from '@/lib/cached-queries'
import { CurrentSiteProvider } from '@/contexts/current-site-context'
import { getPublicLayers, EMPTY_PUBLIC_LAYERS } from '@/lib/public-page-data'
import { readExtraSettings } from '@/lib/settings'

// ISR: published content only and no session read, so the response is the same
// for every visitor. Next.js 16 needs generateStaticParams() — even empty — or
// a dynamic route stays dynamic.
export const revalidate = false
export const dynamicParams = true
export async function generateStaticParams() {
  return []
}

interface OrgTeacherPageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: OrgTeacherPageProps): Promise<Metadata> {
  const { orgSlug, pageSlug } = await params

  try {
    // Get organization (looked up via its Site, since URL slugs live there).
    const orgSite = await prisma.site.findUnique({
      where: { slug: orgSlug },
      select: { organization: { select: { id: true, name: true } } }
    })
    const organization = orgSite?.organization

    if (!organization) {
      return {
        title: 'Organization Not Found',
        description: 'The requested organization could not be found.'
      }
    }

    // Find the teacher whose site slug matches pageSlug AND who is an org
    // member. Page-display fields live on Site now.
    const teacher = await prisma.user.findFirst({
      where: {
        sites: { some: { slug: pageSlug } },
        organizationMemberships: {
          some: { organizationId: organization.id }
        }
      },
      select: {
        name: true,
        bio: true,
        sites: { where: { slug: pageSlug }, take: 1, select: { pageName: true, pageDescription: true } },
      }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher could not be found in this organization.'
      }
    }

    const title = `${teacher.sites[0]?.pageName || teacher.name || 'Teacher'} | ${organization.name}`
    const description = teacher.sites[0]?.pageDescription || teacher.bio || `Educational content by ${teacher.name}`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}`
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description
      }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Eduskript',
      description: 'Educational content platform'
    }
  }
}

export default async function OrgTeacherPage({ params }: OrgTeacherPageProps) {
  const { orgSlug, pageSlug } = await params

  // Get organization (looked up via its Site, which also owns display fields).
  const orgSite = await prisma.site.findUnique({
    where: { slug: orgSlug },
    select: {
      pageDescription: true,
      pageIcon: true,
      showIcon: true,
      organization: {
        select: { id: true, name: true }
      }
    }
  })
  const organization = orgSite?.organization
    ? {
        ...orgSite.organization,
        description: orgSite.pageDescription,
        iconUrl: orgSite.pageIcon,
        showIcon: orgSite.showIcon,
      }
    : null

  if (!organization) {
    notFound()
  }

  // Find teacher whose Site slug matches pageSlug, and who is a member of
  // this org. Layout AND page-display fields all live on Site now.
  const teacher = await prisma.user.findFirst({
    where: {
      sites: { some: { slug: pageSlug } },
      organizationMemberships: {
        some: { organizationId: organization.id }
      }
    },
    include: {
      sites: {
        where: { slug: pageSlug },
        take: 1,
        include: {
          pageLayout: {
            include: {
              items: { orderBy: { order: 'asc' } }
            }
          }
        }
      }
    }
  })
  const teacherSite = teacher?.sites[0]

  if (!teacher) {
    notFound()
  }
  const teacherPageLayout = teacherSite?.pageLayout

  // No session read: this route is ISR-cached, and reading cookies would turn
  // every request back into a dynamic render (the state it was in before). It
  // therefore serves published content only — the same HTML for every visitor.
  // Authors preview unpublished work from the dashboard; owner-only
  // affordances are rendered client-side.

  // Check for frontpage (published for visitors, any for owner). Scope to THIS
  // site (the requested pageSlug), not the user — a teacher may own several
  // sites, each with its own frontpage. Keying on userId returned the primary
  // site's frontpage on every one of the user's slugs (e.g. /mathegarten
  // showed informatikgarten's landing page). Mirrors the [domain] route fix
  // in commit 20ee5bf5; this org route serves eduskript.org/<slug>.
  const frontPage = await prisma.frontPage.findFirst({
    where: { site: { slug: pageSlug } }
  })

  // Fetch public annotations, snaps, and sticky notes for this front page
  const { publicAnnotations, publicSnaps, publicStickyNotes } = frontPage
    ? await getPublicLayers(frontPage.id)
    : EMPTY_PUBLIC_LAYERS

  // Authorship for the annotation toolbar is resolved client-side inside
  // AnnotationLayer, so nothing per-visitor reaches the cached HTML.

  // Get page layout items
  const pageItems = teacherPageLayout?.items || []

  // Fetch collections and root skripts based on page layout
  const collections: Array<{
    id: string
    title: string
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

  for (const item of pageItems) {
    if (item.type === 'collection') {
      const collection = await prisma.collection.findFirst({
        where: {
          id: item.contentId,
        },
        include: {
          collectionSkripts: {
            where: { skript: { isPublished: true, isUnlisted: false } },
            include: {
              skript: {
                include: {
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
          skripts: collection.collectionSkripts.map(cs => ({
            id: cs.skript.id,
            title: cs.skript.title,
            slug: cs.skript.slug,
            pages: cs.skript.pages.map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug
            }))
          }))
        })
      }
    } else if (item.type === 'skript') {
      const skript = await prisma.skript.findFirst({
        where: {
          id: item.contentId,
          isPublished: true,
          isUnlisted: false
        },
        include: {
          collectionSkripts: {
            take: 1,
            include: {
              collection: {
                select: { title: true }
              }
            }
          },
          pages: {
            where: { isPublished: true, isUnlisted: false },
            orderBy: { order: 'asc' },
            select: { id: true, title: true, slug: true }
          }
        }
      })
      // A root skript may have no collection (skripts can exist without one).
      // Push it regardless, with an "Uncategorized" fallback title — mirrors the
      // [domain] route (getTeacherHomepageContent). Requiring a collection here
      // silently dropped collection-less root skripts from the sidebar.
      if (skript) {
        const firstCollection = skript.collectionSkripts[0]?.collection
        rootSkripts.push({
          id: skript.id,
          title: skript.title,
          description: skript.description,
          slug: skript.slug,
          collection: {
            title: firstCollection?.title ?? 'Uncategorized',
          },
          pages: skript.pages.map(p => ({
            id: p.id,
            title: p.title,
            slug: p.slug
          }))
        })
      }
    }
  }

  // Fetch full site structure when sidebar is in "full" mode. URL slug +
  // page-display fields all live on Site now.
  const teacherSlug = teacherSite?.slug ?? pageSlug
  // Default to 'full' — matches the Prisma default ("full") and the [domain]
  // route. Keying null off 'contextual' here meant a site that never set the
  // preference showed an empty sidebar on eduskript.org/<slug> (contextual
  // filters to the current skript, and the frontpage has none) while the same
  // site rendered fully on a custom host.
  const sidebarBehavior = teacherSite?.sidebarBehavior || 'full'
  const fullSiteStructure = sidebarBehavior === 'full'
    ? await getFullSiteStructure(teacher.id, teacherSlug)
    : undefined

  const teacherSiteExtra = readExtraSettings(teacherSite)
  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacherSlug,
    pageName: teacherSite?.pageName ?? null,
    pageDescription: teacherSite?.pageDescription ?? null,
    pageIcon: teacherSite?.pageIcon ?? null,
    titleStyle: teacherSiteExtra.titleStyle ?? 'icon',
    logoUrl: teacherSiteExtra.logoUrl ?? null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  return (
    <CurrentSiteProvider siteId={teacherSite?.id ?? null} organizationId={organization.id}>
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={collections}
      rootSkripts={rootSkripts}
      fullSiteStructure={fullSiteStructure}
      sidebarBehavior={(sidebarBehavior as 'contextual' | 'full') || 'full'}
      typographyPreference={(teacherSite?.typographyPreference as 'modern' | 'classic') || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        {/* Frontpage content or empty state for owners */}
        {frontPage?.content ? (
          <article className="prose-theme">
            <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} publicStickyNotes={publicStickyNotes}>
              <ServerMarkdownRenderer
                content={frontPage.content}
                pageId={frontPage.id}
              />
            </AnnotationWrapper>
          </article>
        ) : (
          <div className="text-center py-12">
            {/* Owner-only prompt, client-side so this stays cacheable. */}
            <FrontpageOwnerCta ownerId={teacher.id} href="/dashboard/frontpage" />
            <h1 className="text-3xl font-bold mb-4">
              {teacher.name}&apos;s Educational Platform
            </h1>
            {teacher.bio && (
              <p className="text-muted-foreground">
                {teacher.bio}
              </p>
            )}
          </div>
        )}
      </div>
    </PublicSiteLayout>
    </CurrentSiteProvider>
  )
}
