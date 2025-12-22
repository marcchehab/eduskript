import { notFound } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'

interface PageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
    collectionSlug: string
    skriptSlug: string
  }>
}

// Enable ISR
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, pageSlug, collectionSlug, skriptSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Find teacher
    const teacher = await prisma.user.findFirst({
      where: {
        pageSlug: pageSlug,
        organizationMemberships: {
          some: { organizationId: organization.id }
        }
      },
      select: { id: true, name: true, pageName: true }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher could not be found.'
      }
    }

    // Get the skript
    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        collectionSkripts: {
          some: {
            collection: {
              slug: collectionSlug,
              authors: {
                some: { userId: teacher.id }
              }
            }
          }
        }
      }
    })

    if (!skript) {
      return {
        title: 'Skript Not Found',
        description: 'The requested skript could not be found.',
        robots: 'noindex'
      }
    }

    const teacherName = teacher.pageName || teacher.name || 'Teacher'
    const title = `${skript.title} | ${teacherName} | ${organization.name}`
    const description = skript.description || `${skript.title} by ${teacherName}`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}/${collectionSlug}/${skriptSlug}`
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

export default async function OrgTeacherSkriptPage({ params }: PageProps) {
  const { orgSlug, pageSlug, collectionSlug, skriptSlug } = await params

  // Get organization
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      description: true,
      logoUrl: true
    }
  })

  if (!organization) {
    notFound()
  }

  // Find teacher
  const teacher = await prisma.user.findFirst({
    where: {
      pageSlug: pageSlug,
      organizationMemberships: {
        some: { organizationId: organization.id }
      }
    },
    select: {
      id: true,
      name: true,
      pageName: true,
      pageDescription: true,
      pageIcon: true,
      bio: true,
      title: true,
      sidebarBehavior: true,
      typographyPreference: true
    }
  })

  if (!teacher) {
    notFound()
  }

  // Get the skript with its frontpage and pages
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      collectionSkripts: {
        some: {
          collection: {
            slug: collectionSlug,
            authors: {
              some: { userId: teacher.id }
            }
          }
        }
      }
    },
    include: {
      frontPage: true,
      collectionSkripts: {
        where: {
          collection: { slug: collectionSlug }
        },
        include: { collection: true },
        take: 1
      },
      pages: {
        where: { isPublished: true },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, slug: true }
      }
    }
  })

  if (!skript || !skript.collectionSkripts[0]?.collection) {
    notFound()
  }

  // collection is guaranteed to exist by the check above
  const collection = skript.collectionSkripts[0].collection!

  // Build site structure
  const siteStructure = [{
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    skripts: [{
      id: skript.id,
      title: skript.title,
      slug: skript.slug,
      pages: skript.pages.map(p => ({
        id: p.id,
        title: p.title,
        slug: p.slug
      }))
    }]
  }]

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacher.pageName || pageSlug,
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${collectionSlug}/${skriptSlug}`

  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={siteStructure}
      currentPath={currentPath}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10">
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
