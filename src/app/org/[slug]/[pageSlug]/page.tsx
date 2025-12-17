import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { prisma } from '@/lib/prisma'

// Enable ISR - pages are cached until explicitly invalidated
export const revalidate = false
export const dynamicParams = true

interface OrgTeacherPageProps {
  params: Promise<{
    slug: string
    pageSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: OrgTeacherPageProps): Promise<Metadata> {
  const { slug: orgSlug, pageSlug } = await params

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
  const { slug: orgSlug, pageSlug } = await params

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
    where: {
      userId: teacher.id,
      ...(isOwner ? {} : { isPublished: true })
    }
  })

  // Fetch public annotations for this front page
  const publicAnnotations = frontPage ? await prisma.userData.findMany({
    where: {
      adapter: 'annotations',
      itemId: frontPage.id,
      targetType: 'page',
    },
    select: {
      data: true,
      userId: true,
      user: { select: { name: true } }
    }
  }) : []

  // Owner can create public annotations on their own front page
  const isPageAuthor = isOwner

  // Check if this is a preview (unpublished)
  const isPreviewMode = isOwner && frontPage && !frontPage.isPublished

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
          ...(isOwner ? {} : { isPublished: true })
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
            pages: cs.skript.pages
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
          collection: skript.collectionSkripts[0].collection,
          pages: skript.pages
        })
      }
    }
  }

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
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10" style={{ maxWidth: 'min(1280px, calc(100vw - 48px))', marginLeft: 'auto', marginRight: 'auto' }}>
        {/* Preview mode indicator for unpublished frontpage */}
        {isPreviewMode && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-4 text-sm rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span><span className="font-semibold">Preview:</span> Not published yet. Only you can see this.</span>
          </div>
        )}

        {/* Frontpage content or empty state for owners */}
        {frontPage?.content ? (
          <article className="prose-theme">
            <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor}>
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
