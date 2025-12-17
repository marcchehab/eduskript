import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getOrgMembership } from '@/lib/org-auth'

// Enable ISR - pages are cached until explicitly invalidated
export const revalidate = false
export const dynamicParams = true

interface SkriptPageProps {
  params: Promise<{
    slug: string
    collectionSlug: string
    skriptSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: SkriptPageProps): Promise<Metadata> {
  const { slug, collectionSlug, skriptSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return {
        title: 'Organization Not Found',
        description: 'The requested organization could not be found.'
      }
    }

    // Get org admins
    const adminMembers = await prisma.organizationMember.findMany({
      where: {
        organizationId: organization.id,
        role: { in: ['owner', 'admin'] }
      },
      select: { userId: true }
    })
    const adminUserIds = adminMembers.map(m => m.userId)

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        collectionSkripts: {
          some: {
            collection: {
              slug: collectionSlug,
              authors: { some: { userId: { in: adminUserIds } } }
            }
          }
        }
      },
      select: { title: true }
    })

    if (!skript) {
      return {
        title: 'Skript Not Found',
        description: 'The requested skript could not be found.'
      }
    }

    return {
      title: `${skript.title} | ${organization.name}`,
      description: `${skript.title} by ${organization.name}`
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Eduskript',
      description: 'Educational content platform'
    }
  }
}

export default async function OrgSkriptPage({ params }: SkriptPageProps) {
  const { slug, collectionSlug, skriptSlug } = await params

  // Get organization
  const organization = await prisma.organization.findUnique({
    where: { slug },
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

  // Check if user is org admin
  const session = await getServerSession(authOptions)
  const membership = session?.user?.id
    ? await getOrgMembership(session.user.id, organization.id)
    : null
  const isAdmin =
    session?.user?.isAdmin ||
    membership?.role === 'owner' ||
    membership?.role === 'admin'

  // Get org admins for content lookup
  const adminMembers = await prisma.organizationMember.findMany({
    where: {
      organizationId: organization.id,
      role: { in: ['owner', 'admin'] }
    },
    select: { userId: true }
  })
  const adminUserIds = adminMembers.map(m => m.userId)

  // Find the collection with the specific skript
  const collection = await prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: { some: { userId: { in: adminUserIds } } }
    },
    include: {
      collectionSkripts: {
        where: { skript: { slug: skriptSlug } },
        include: {
          skript: {
            include: {
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
          }
        }
      }
    }
  })

  if (!collection) {
    notFound()
  }

  // Authorization: Only admins can view unpublished collections
  if (!collection.isPublished && !isAdmin) {
    notFound()
  }

  const collectionSkript = collection.collectionSkripts[0]
  if (!collectionSkript) {
    notFound()
  }

  const skript = collectionSkript.skript

  // Authorization: Only admins can view unpublished skripts
  if (!skript.isPublished && !isAdmin) {
    notFound()
  }

  // Check for skript frontpage
  const frontPage = await prisma.frontPage.findFirst({
    where: {
      skriptId: skript.id,
      ...(isAdmin ? {} : { isPublished: true })
    }
  })

  // Fetch public annotations for this skript front page
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

  // Org admins can create public annotations on skript front pages
  const isPageAuthor = isAdmin

  const showFrontpage = frontPage?.content || isAdmin

  if (showFrontpage) {
    const isPreviewMode = isAdmin && frontPage && !frontPage.isPublished

    // Build site structure
    const availablePages = skript.pages.filter(page => isAdmin || page.isPublished)
    const siteStructure = [{
      id: collection.id,
      title: collection.title,
      slug: collection.slug,
      skripts: [{
        id: skript.id,
        title: skript.title,
        slug: skript.slug,
        pages: availablePages.map(p => ({
          id: p.id,
          title: p.title,
          slug: p.slug
        }))
      }]
    }]

    const orgAsTeacher = {
      name: organization.name,
      pageSlug: `org/${slug}`,
      pageName: organization.name,
      pageDescription: organization.description,
      pageIcon: organization.logoUrl,
      bio: null,
      title: null
    }

    return (
      <PublicSiteLayout
        teacher={orgAsTeacher}
        siteStructure={siteStructure}
        rootSkripts={[]}
        sidebarBehavior="contextual"
        typographyPreference="modern"
        routePrefix={`/org/${slug}/c`}
      >
        <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10" style={{ maxWidth: 'min(1280px, calc(100vw - 48px))', marginLeft: 'auto', marginRight: 'auto' }}>
          {isPreviewMode && (
            <div className="flex items-center gap-2 px-3 py-1.5 mb-4 text-sm rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
              <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span><span className="font-semibold">Preview:</span> Not published yet. Only admins can see this.</span>
            </div>
          )}

          {frontPage?.content ? (
            <article className="prose-theme">
              <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor}>
                <ServerMarkdownRenderer
                  content={frontPage.content}
                  skriptId={skript.id}
                  pageId={frontPage.id}
                  organizationSlug={slug}
                />
              </AnnotationWrapper>
            </article>
          ) : isAdmin ? (
            <div className="text-center py-12">
              <h1 className="text-3xl font-bold mb-4">{skript.title}</h1>
              <p className="text-muted-foreground mb-6">
                This skript doesn&apos;t have a frontpage yet.
              </p>
              <Link
                href={`/dashboard/collections/${collectionSlug}/skripts/${skriptSlug}/frontpage`}
                className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Create Frontpage
              </Link>
            </div>
          ) : null}
        </div>
      </PublicSiteLayout>
    )
  }

  // No frontpage - redirect to first available page
  const firstPage = skript.pages.find(page => isAdmin || page.isPublished)

  if (firstPage) {
    const redirectUrl = `/org/${slug}/c/${collectionSlug}/${skriptSlug}/${firstPage.slug}`
    return <SkriptRedirect redirectUrl={redirectUrl} />
  }

  // No pages available - 404
  notFound()
}
