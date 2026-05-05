import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { prisma } from '@/lib/prisma'
import { getFullSiteStructure } from '@/lib/cached-queries'
import { getPublicLayers, EMPTY_PUBLIC_LAYERS } from '@/lib/public-page-data'

export const dynamic = 'force-dynamic'
export const dynamicParams = true

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
    // Get organization
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return {
        title: 'Organization Not Found',
        description: 'The requested organization could not be found.'
      }
    }

    // Find teacher who is a member of this org
    const teacher = await prisma.user.findFirst({
      where: {
        pageSlug: pageSlug,
        organizationMemberships: {
          some: { organizationId: organization.id }
        }
      },
      select: {
        name: true,
        pageName: true,
        pageDescription: true,
        bio: true
      }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher could not be found in this organization.'
      }
    }

    const title = `${teacher.pageName || teacher.name || 'Teacher'} | ${organization.name}`
    const description = teacher.pageDescription || teacher.bio || `Educational content by ${teacher.name}`

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

  // Get organization
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

  // Find teacher who is a member of this org with their page layout
  const teacher = await prisma.user.findFirst({
    where: {
      pageSlug: pageSlug,
      organizationMemberships: {
        some: { organizationId: organization.id }
      }
    },
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

  if (!teacher) {
    notFound()
  }

  // Check if current user is the owner of this page
  const session = await getServerSession(authOptions)
  const isOwner = session?.user?.id === teacher.id

  // Check for frontpage (published for visitors, any for owner)
  const frontPage = await prisma.frontPage.findFirst({
    where: { userId: teacher.id }
  })

  // Fetch public annotations, snaps, and sticky notes for this front page
  const { publicAnnotations, publicSnaps, publicStickyNotes } = frontPage
    ? await getPublicLayers(frontPage.id)
    : EMPTY_PUBLIC_LAYERS

  // Owner can create public annotations on their own front page
  const isPageAuthor = isOwner

  // Get page layout items
  const pageItems = teacher.pageLayout?.items || []

  // Fetch collections and root skripts based on page layout
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

  for (const item of pageItems) {
    if (item.type === 'collection') {
      const collection = await prisma.collection.findFirst({
        where: {
          id: item.contentId,
        },
        include: {
          collectionSkripts: {
            where: isOwner ? {} : { skript: { isPublished: true } },
            include: {
              skript: {
                include: {
                  pages: {
                    where: isOwner ? {} : { isPublished: true },
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
          ...(isOwner ? {} : { isPublished: true })
        },
        include: {
          collectionSkripts: {
            take: 1,
            include: {
              collection: {
                select: { title: true, slug: true }
              }
            }
          },
          pages: {
            where: isOwner ? {} : { isPublished: true },
            orderBy: { order: 'asc' },
            select: { id: true, title: true, slug: true }
          }
        }
      })
      if (skript && skript.collectionSkripts[0]?.collection) {
        rootSkripts.push({
          id: skript.id,
          title: skript.title,
          description: skript.description,
          slug: skript.slug,
          collection: {
            title: skript.collectionSkripts[0].collection.title,
            slug: skript.collectionSkripts[0].collection.slug
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

  // Fetch full site structure when sidebar is in "full" mode
  const fullSiteStructure = teacher.sidebarBehavior === 'full'
    ? await getFullSiteStructure(teacher.id, teacher.pageSlug || pageSlug)
    : undefined

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacher.pageSlug || '',
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={collections}
      rootSkripts={rootSkripts}
      fullSiteStructure={fullSiteStructure}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        {/* Frontpage content or empty state for owners */}
        {frontPage?.content ? (
          <article className="prose-theme">
            <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} publicStickyNotes={publicStickyNotes} isPageAuthor={isPageAuthor}>
              <ServerMarkdownRenderer
                content={frontPage.content}
                pageId={frontPage.id}
              />
            </AnnotationWrapper>
          </article>
        ) : isOwner ? (
          <div className="text-center py-12">
            <h1 className="text-3xl font-bold mb-4">Your Frontpage</h1>
            <p className="text-muted-foreground mb-6">
              You haven&apos;t created a frontpage yet.
            </p>
            <Link
              href="/dashboard/frontpage"
              className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Create Frontpage
            </Link>
          </div>
        ) : (
          <div className="text-center py-12">
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
  )
}
