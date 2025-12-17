import { notFound } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ExportPDF } from '@/components/public/export-pdf'
import { DevClearDataButton } from '@/components/dev/dev-clear-data-button'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getOrgPublishedPage } from '@/lib/cached-queries'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

interface PageProps {
  params: Promise<{
    slug: string
    collectionSlug: string
    skriptSlug: string
    pageSlug: string
  }>
}

// Enable ISR - pages are cached until explicitly invalidated via revalidateTag
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, collectionSlug, skriptSlug, pageSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    const content = await getOrgPublishedPage(
      organization.id,
      slug,
      collectionSlug,
      skriptSlug,
      pageSlug
    )

    if (!content) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.',
        robots: 'noindex'
      }
    }

    const title = `${content.page.title} | ${organization.name}`
    const description = content.collection.description || `${content.page.title} by ${organization.name}`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'article',
        siteName: organization.name,
        url: `/org/${slug}/c/${collectionSlug}/${skriptSlug}/${pageSlug}`
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

export default async function OrgPublicPage({ params }: PageProps) {
  const { slug, collectionSlug, skriptSlug, pageSlug } = await params

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

  // Get published content
  const content = await getOrgPublishedPage(
    organization.id,
    slug,
    collectionSlug,
    skriptSlug,
    pageSlug
  )

  if (!content) {
    notFound()
  }

  const { collection, skript, page, allPages } = content

  // Fetch public annotations for this page (annotations broadcast to all visitors)
  const publicAnnotations = await prisma.userData.findMany({
    where: {
      adapter: 'annotations',
      itemId: page.id,
      targetType: 'page',
    },
    select: {
      data: true,
      userId: true,
      user: { select: { name: true } }
    }
  })

  // Check if current user can create public annotations
  // For org pages: user must be org admin/owner with author permission on skript
  let isPageAuthor = false
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    // Check if user is org admin/owner
    const orgMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: organization.id,
        userId: session.user.id,
        role: { in: ['owner', 'admin'] }
      }
    })
    if (orgMember) {
      // Check if user has author permission on the skript
      const skriptAuthor = await prisma.skriptAuthor.findFirst({
        where: {
          skriptId: skript.id,
          userId: session.user.id,
          permission: 'author'
        }
      })
      isPageAuthor = !!skriptAuthor
    }
  }

  // Build site structure for navigation (only published pages)
  const siteStructure = [{
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    skripts: [{
      id: skript.id,
      title: skript.title,
      slug: skript.slug,
      pages: allPages.map(p => ({
        id: p.id,
        title: p.title,
        slug: p.slug
      }))
    }]
  }]

  // Create org as "teacher" for the layout
  const orgAsTeacher = {
    name: organization.name,
    pageSlug: `org/${slug}`,
    pageName: organization.name,
    pageDescription: organization.description,
    pageIcon: organization.logoUrl,
    bio: null,
    title: null
  }

  const currentPath = `/${collectionSlug}/${skriptSlug}/${pageSlug}`

  return (
    <PublicSiteLayout
      teacher={orgAsTeacher}
      siteStructure={siteStructure}
      currentPath={currentPath}
      sidebarBehavior="contextual"
      typographyPreference="modern"
      routePrefix={`/org/${slug}/c`}
      pageId={page.id}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10" style={{ maxWidth: 'min(1280px, calc(100vw - 48px))', marginLeft: 'auto', marginRight: 'auto' }}>
        <article className="prose-theme">
          <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor}>
            <ServerMarkdownRenderer
              content={page.content}
              skriptId={skript.id}
              pageId={page.id}
              organizationSlug={slug}
            />
          </AnnotationWrapper>
        </article>

        <div className="mt-8 pt-8 border-t border-border">
          <ExportPDF
            content={page.content}
            title={page.title}
            author={organization.name}
          />
        </div>
      </div>

      <DevClearDataButton pageId={page.id} />
    </PublicSiteLayout>
  )
}
