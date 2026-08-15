import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getOrgFullSiteStructure } from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'
import { getPublicLayers, EMPTY_PUBLIC_LAYERS } from '@/lib/public-page-data'

// ISR: published content only and no session read, so every visitor gets the
// same HTML. Next.js 16 needs generateStaticParams() — even empty — or a
// dynamic route stays dynamic.
export const revalidate = false
export const dynamicParams = true
export async function generateStaticParams() {
  return []
}

interface SkriptPageProps {
  params: Promise<{
    orgSlug: string
    skriptSlug: string
  }>
}

export async function generateMetadata({ params }: SkriptPageProps): Promise<Metadata> {
  const { orgSlug, skriptSlug } = await params

  try {
    const orgSite = await prisma.site.findUnique({
      where: { slug: orgSlug },
      select: { organization: { select: { id: true, name: true } } }
    })
    const organization = orgSite?.organization ?? null

    if (!organization) {
      return { title: 'Organization Not Found' }
    }

    const adminMembers = await prisma.organizationMember.findMany({
      where: { organizationId: organization.id, role: { in: ['owner', 'admin'] } },
      select: { userId: true }
    })
    const orgAdminIds = adminMembers.map(m => m.userId)

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        OR: [
          { authors: { some: { userId: { in: orgAdminIds } } } },
          { collectionSkripts: { some: { collection: { site: { organizationId: organization.id } } } } },
          { collectionSkripts: { some: { collection: { site: { userId: { in: orgAdminIds } } } } } }
        ]
      },
      select: { title: true }
    })

    if (!skript) {
      return { title: 'Skript Not Found' }
    }

    return {
      title: `${skript.title} | ${organization.name}`,
      description: `${skript.title} by ${organization.name}`
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return { title: 'Eduskript' }
  }
}

export default async function OrgSkriptPage({ params }: SkriptPageProps) {
  const { orgSlug, skriptSlug } = await params

  const orgSite = await prisma.site.findUnique({
    where: { slug: orgSlug },
    select: {
      // Page-display fields live on Site; org carries only the entity name.
      pageDescription: true,
      pageIcon: true,
      showIcon: true,
      sidebarBehavior: true,
      organization: { select: { id: true, name: true } },
    }
  })
  const organization = orgSite?.organization
    ? {
        ...orgSite.organization,
        description: orgSite.pageDescription,
        iconUrl: orgSite.pageIcon,
        showIcon: orgSite.showIcon,
        sidebarBehavior: orgSite.sidebarBehavior,
      }
    : null

  if (!organization) {
    notFound()
  }

  // Check if user is org admin
  // No session read: reading cookies would opt this route out of static
  // rendering (and an org-membership query per request with it). Admins
  // preview unpublished skripts from the dashboard.

  // Get org admins for content lookup
  const adminMembers = await prisma.organizationMember.findMany({
    where: {
      organizationId: organization.id,
      role: { in: ['owner', 'admin'] }
    },
    select: { userId: true }
  })
  const adminUserIds = adminMembers.map(m => m.userId)

  // Find skript by slug scoped to org admins
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      OR: [
        { authors: { some: { userId: { in: adminUserIds } } } },
        { collectionSkripts: { some: { collection: { site: { organizationId: organization.id } } } } },
        { collectionSkripts: { some: { collection: { site: { userId: { in: adminUserIds } } } } } }
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
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          order: true,
          isPublished: true
        }
      }
    }
  })

  if (!skript) {
    notFound()
  }

  // Only published skripts are served here; the admin exception moved to the
  // dashboard so this response can be shared by every visitor.
  if (!skript.isPublished) {
    notFound()
  }

  // Check for skript frontpage
  const frontPage = await prisma.frontPage.findFirst({
    where: {
      skriptId: skript.id,
      isPublished: true
    }
  })

  // Fetch public annotations, snaps, and sticky notes for this skript front page
  const { publicAnnotations, publicSnaps, publicStickyNotes } = frontPage
    ? await getPublicLayers(frontPage.id)
    : EMPTY_PUBLIC_LAYERS

  // Authorship for the annotation toolbar is resolved client-side inside
  // AnnotationLayer, so nothing per-visitor reaches the cached HTML.
  const showFrontpage = Boolean(frontPage?.content)

  const collectionSkript = skript.collectionSkripts[0]
  const collection = collectionSkript?.collection

  if (showFrontpage) {
    // Build site structure
    const availablePages = skript.pages.filter(page => page.isPublished)
    const siteStructure = collection
      ? buildSiteStructure([{
          id: collection.id,
          title: collection.title,
          accentColor: collection.accentColor,
          collectionSkripts: [{
            order: collectionSkript.order,
            skript: {
              ...skript,
              pages: availablePages
            }
          }]
        }], { onlyPublished: true })
      : [{
          id: 'standalone',
          title: skript.title,
          skripts: [{
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            order: 0,
            pages: availablePages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
          }]
        }]

    const orgAsTeacher = {
      name: organization.name,
      pageSlug: `org/${orgSlug}`,
      pageName: organization.name,
      pageDescription: organization.description,
      pageIcon: organization.showIcon ? (organization.iconUrl || 'default') : null,
      bio: null,
      title: null
    }

    const fullSiteStructure = organization.sidebarBehavior === 'full'
      ? await getOrgFullSiteStructure(organization.id, orgSlug)
      : undefined

    return (
      <PublicSiteLayout
        teacher={orgAsTeacher}
        siteStructure={fullSiteStructure ?? siteStructure}
        rootSkripts={[]}
        fullSiteStructure={fullSiteStructure}
        sidebarBehavior={organization.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
        typographyPreference="modern"
        routePrefix={`/org/${orgSlug}/c`}
        homeUrl={`/org/${orgSlug}`}
      >
        <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
          {frontPage?.content ? (
            <article className="prose-theme">
              <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} publicStickyNotes={publicStickyNotes}>
                <ServerMarkdownRenderer
                  content={frontPage.content}
                  skriptId={skript.id}
                  pageId={frontPage.id}
                  organizationSlug={orgSlug}
                />
              </AnnotationWrapper>
            </article>
          ) : null}
        </div>
      </PublicSiteLayout>
    )
  }

  // No frontpage - redirect to first available page
  const firstPage = skript.pages.find(page => page.isPublished)

  if (firstPage) {
    return <SkriptRedirect redirectUrl={`/org/${orgSlug}/c/${skriptSlug}/${firstPage.slug}`} />
  }

  notFound()
}
