import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getFullSiteStructure } from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'

interface PageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
    skriptSlug: string
  }>
}

// Enable ISR
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, pageSlug, skriptSlug } = await params

  try {
    const orgSite = await prisma.site.findUnique({
      where: { slug: orgSlug },
      select: { organization: { select: { id: true, name: true } } }
    })
    const organization = orgSite?.organization

    if (!organization) {
      return { title: 'Page Not Found' }
    }

    const teacher = await prisma.user.findFirst({
      where: {
        site: { slug: pageSlug },
        organizationMemberships: { some: { organizationId: organization.id } }
      },
      select: { id: true, name: true, site: { select: { pageName: true } } }
    })

    if (!teacher) {
      return { title: 'Teacher Not Found' }
    }

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        OR: [
          { authors: { some: { userId: teacher.id } } },
          { collectionSkripts: { some: { collection: { site: { userId: teacher.id } } } } }
        ]
      },
      select: { title: true, description: true }
    })

    if (!skript) {
      return { title: 'Skript Not Found', robots: 'noindex' }
    }

    const teacherName = teacher.site?.pageName || teacher.name || 'Teacher'
    const title = `${skript.title} | ${teacherName} | ${organization.name}`

    return {
      title,
      description: skript.description || `${skript.title} by ${teacherName}`,
      openGraph: {
        title,
        type: 'website',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}/${skriptSlug}`
      }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return { title: 'Eduskript' }
  }
}

export default async function OrgTeacherSkriptPage({ params }: PageProps) {
  const { orgSlug, pageSlug, skriptSlug } = await params

  const orgSiteRow = await prisma.site.findUnique({
    where: { slug: orgSlug },
    select: {
      pageDescription: true,
      pageIcon: true,
      showIcon: true,
      organization: { select: { id: true, name: true } }
    }
  })
  const organization = orgSiteRow?.organization
    ? {
        ...orgSiteRow.organization,
        description: orgSiteRow.pageDescription,
        iconUrl: orgSiteRow.pageIcon,
        showIcon: orgSiteRow.showIcon,
      }
    : null

  if (!organization) {
    notFound()
  }

  // Page-display fields + sidebar/typography prefs live on Site.
  const teacher = await prisma.user.findFirst({
    where: {
      site: { slug: pageSlug },
      organizationMemberships: { some: { organizationId: organization.id } }
    },
    select: {
      id: true,
      name: true,
      bio: true,
      title: true,
      site: {
        select: {
          slug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          sidebarBehavior: true,
          typographyPreference: true,
        },
      },
    }
  })

  if (!teacher) {
    notFound()
  }

  // Find skript by slug scoped to teacher
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      OR: [
        { authors: { some: { userId: teacher.id } } },
        { collectionSkripts: { some: { collection: { site: { userId: teacher.id } } } } }
      ]
    },
    include: {
      frontPage: true,
      collectionSkripts: {
        include: {
          collection: true
        },
        orderBy: { order: 'asc' },
        take: 1
      },
      pages: {
        where: { isPublished: true },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, slug: true }
      }
    }
  })

  if (!skript) {
    notFound()
  }

  const collectionSkript = skript.collectionSkripts[0]
  const collection = collectionSkript?.collection

  // Check if current user is an author (to show unpublished content in sidebar)
  const session = await getServerSession(authOptions)
  const isAuthor = session?.user?.id === teacher.id

  // Build site structure
  const siteStructure = collection
    ? buildSiteStructure([{
        id: collection.id,
        title: collection.title,
        accentColor: collection.accentColor,
        collectionSkripts: [{
          order: collectionSkript.order,
          skript: {
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            isPublished: skript.isPublished,
            pages: skript.pages.map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              isPublished: true,
              order: 0
            }))
          }
        }]
      }], { onlyPublished: !isAuthor })
    : [{
        id: 'standalone',
        title: skript.title,
        skripts: [{
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          order: 0,
          pages: skript.pages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
        }]
      }]

  const teacherSite = teacher.site
  const fullSiteStructure = teacherSite?.sidebarBehavior === 'full'
    ? await getFullSiteStructure(teacher.id, teacherSite.slug)
    : undefined

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacherSite?.slug || pageSlug,
    pageName: teacherSite?.pageName || null,
    pageDescription: teacherSite?.pageDescription || null,
    pageIcon: teacherSite?.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${skriptSlug}`

  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={siteStructure}
      fullSiteStructure={fullSiteStructure}
      currentPath={currentPath}
      sidebarBehavior={(teacherSite?.sidebarBehavior as 'contextual' | 'full') || 'contextual'}
      typographyPreference={(teacherSite?.typographyPreference as 'modern' | 'classic') || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
      {/* Class toolbar (portals into the sidebar slot). Gated server-side on
          isAuthor like the org content page; the toolbar still self-gates on
          paid + has-classes. Needs the frontPage id as pageId. */}
      {isAuthor && skript.frontPage?.id && (
        <ClassToolbar
          pageId={skript.frontPage.id}
          pageType="standard"
          unlockedClasses={[]}
        />
      )}
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        {skript.frontPage?.content ? (
          <article className="prose-theme">
            <ServerMarkdownRenderer
              content={skript.frontPage.content}
              skriptId={skript.id}
              organizationSlug={orgSlug}
            />
          </article>
        ) : (
          <div className="text-center py-12">
            <h1 className="text-3xl font-bold mb-4">{skript.title}</h1>
            {skript.description && (
              <p className="text-muted-foreground mb-6">{skript.description}</p>
            )}
            {skript.pages.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Select a page from the sidebar to begin.
              </p>
            )}
          </div>
        )}
      </div>
    </PublicSiteLayout>
  )
}
