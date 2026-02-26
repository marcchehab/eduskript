import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
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
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return { title: 'Page Not Found' }
    }

    const teacher = await prisma.user.findFirst({
      where: {
        pageSlug: pageSlug,
        organizationMemberships: { some: { organizationId: organization.id } }
      },
      select: { id: true, name: true, pageName: true }
    })

    if (!teacher) {
      return { title: 'Teacher Not Found' }
    }

    const skript = await prisma.skript.findUnique({
      where: { slug: skriptSlug },
      select: { title: true, description: true }
    })

    if (!skript) {
      return { title: 'Skript Not Found', robots: 'noindex' }
    }

    const teacherName = teacher.pageName || teacher.name || 'Teacher'
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

  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      description: true,
      showIcon: true,
      iconUrl: true
    }
  })

  if (!organization) {
    notFound()
  }

  const teacher = await prisma.user.findFirst({
    where: {
      pageSlug: pageSlug,
      organizationMemberships: { some: { organizationId: organization.id } }
    },
    select: {
      id: true,
      name: true,
      pageSlug: true,
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

  // Find skript by unique slug, verify teacher authorship
  const skript = await prisma.skript.findUnique({
    where: { slug: skriptSlug },
    include: {
      frontPage: true,
      authors: { where: { userId: teacher.id }, select: { userId: true } },
      collectionSkripts: {
        include: {
          collection: {
            include: {
              authors: { where: { userId: teacher.id }, select: { userId: true } }
            }
          }
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

  // Verify teacher is an author
  const isTeacherAuthor = skript.authors.length > 0 ||
    skript.collectionSkripts.some(cs => (cs.collection?.authors?.length ?? 0) > 0)
  if (!isTeacherAuthor) {
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
        slug: collection.slug,
        accentColor: collection.accentColor,
        isPublished: collection.isPublished,
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
        slug: skript.slug,
        skripts: [{
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          order: 0,
          pages: skript.pages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
        }]
      }]

  const fullSiteStructure = teacher.sidebarBehavior === 'full'
    ? await getFullSiteStructure(teacher.id, teacher.pageSlug || pageSlug)
    : undefined

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacher.pageSlug || pageSlug,
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
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
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
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
