import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getOrgMembership } from '@/lib/org-auth'
import { getOrgWithLayout, getOrgHomepageContent } from '@/lib/cached-queries'
import { prisma } from '@/lib/prisma'

// Enable ISR - pages are cached until explicitly invalidated
export const revalidate = false
export const dynamicParams = true

interface OrgPageProps {
  params: Promise<{
    slug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: OrgPageProps): Promise<Metadata> {
  const { slug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug },
      select: { name: true, description: true, logoUrl: true },
    })

    if (!organization) {
      return {
        title: 'Organization Not Found',
        description: 'The requested organization could not be found.',
      }
    }

    return {
      title: organization.name,
      description: organization.description || `${organization.name} on Eduskript`,
      openGraph: {
        title: organization.name,
        description: organization.description || `${organization.name} on Eduskript`,
        type: 'website',
        siteName: organization.name,
        ...(organization.logoUrl && { images: [organization.logoUrl] }),
      },
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Eduskript',
      description: 'Educational content platform',
    }
  }
}

export default async function OrgPage({ params }: OrgPageProps) {
  const { slug } = await params

  // Get organization with layout using cached query
  const organization = await getOrgWithLayout(slug)

  if (!organization) {
    notFound()
  }

  // Check if current user is an admin/owner
  const session = await getServerSession(authOptions)
  const membership = session?.user?.id
    ? await getOrgMembership(session.user.id, organization.id)
    : null
  const isAdmin =
    session?.user?.isAdmin ||
    membership?.role === 'owner' ||
    membership?.role === 'admin'

  // Determine if front page should be shown
  const frontPage = organization.frontPage
  const showFrontPage = frontPage && (frontPage.isPublished || isAdmin)
  const isPreviewMode = isAdmin && frontPage && !frontPage.isPublished

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

  // Org admins/owners can create public annotations on the org front page
  const isPageAuthor = isAdmin

  // Get page layout items
  const pageItems = organization.pageLayout?.items || []

  // Fetch homepage content using cached query
  const { collections, rootSkripts } = pageItems.length > 0
    ? await getOrgHomepageContent(
        organization.id,
        slug,
        pageItems.map(item => ({ type: item.type, contentId: item.contentId }))
      )
    : { collections: [], rootSkripts: [] }

  // Create a "teacher" object for PublicSiteLayout (org acts as page owner)
  const orgAsTeacher = {
    name: organization.name,
    pageSlug: `org/${slug}`, // Used for localStorage keys
    pageName: organization.name,
    pageDescription: organization.description,
    pageIcon: organization.logoUrl,
    bio: null,
    title: null
  }

  return (
    <PublicSiteLayout
      teacher={orgAsTeacher}
      siteStructure={collections}
      rootSkripts={rootSkripts}
      sidebarBehavior="contextual"
      typographyPreference="modern"
      routePrefix={`/org/${slug}/c`}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10" style={{ maxWidth: 'min(1280px, calc(100vw - 48px))', marginLeft: 'auto', marginRight: 'auto' }}>
        {/* Preview mode indicator for unpublished frontpage */}
        {isPreviewMode && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-4 text-sm rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span><span className="font-semibold">Preview:</span> Not published yet. Only admins can see this.</span>
          </div>
        )}

        {/* Frontpage content or empty state for admins */}
        {showFrontPage && frontPage.content ? (
          <article className="prose-theme">
            <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor}>
              <ServerMarkdownRenderer
                content={frontPage.content}
                pageId={frontPage.id}
                organizationSlug={slug}
              />
            </AnnotationWrapper>
          </article>
        ) : isAdmin && !frontPage ? (
          <div className="text-center py-12">
            <h1 className="text-3xl font-bold mb-4">Your Organization&apos;s Frontpage</h1>
            <p className="text-muted-foreground mb-6">
              You haven&apos;t created a frontpage yet. Use the{' '}
              <code className="px-1 py-0.5 bg-muted rounded text-sm">&lt;OurTeachers /&gt;</code>{' '}
              component to display your organization&apos;s teachers.
            </p>
            <Link
              href={`/dashboard/org/${organization.id}/frontpage`}
              className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Create Frontpage
            </Link>
          </div>
        ) : !showFrontPage && !isAdmin ? (
          <div className="text-center py-12">
            <h1 className="text-3xl font-bold mb-4">
              Welcome to {organization.name}
            </h1>
            <p className="text-muted-foreground">
              This organization is setting up their page. Check back soon!
            </p>
          </div>
        ) : null}
      </div>
    </PublicSiteLayout>
  )
}
