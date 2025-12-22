import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ExportPDF } from '@/components/public/export-pdf'
import type { Metadata } from 'next'

interface PageProps {
  params: Promise<{
    domain: string
    collectionSlug: string
    skriptSlug: string
    pageSlug: string
  }>
}

// Preview routes are always dynamic (auth required)
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, pageSlug } = await params

  return {
    title: `Preview: ${pageSlug}`,
    description: 'Draft preview - not published',
    robots: 'noindex, nofollow'
  }
}

export default async function PreviewPage({ params }: PageProps) {
  const { domain, collectionSlug, skriptSlug, pageSlug } = await params

  // Auth required for preview
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  // Get teacher by username
  const teacher = await prisma.user.findFirst({
    where: { pageSlug: domain }
  })

  if (!teacher) {
    notFound()
  }

  // Only the author can view previews
  const isAuthor = session.user.email === teacher.email
  if (!isAuthor) {
    notFound()
  }

  // Fetch the content (including unpublished)
  const fullCollection = await prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: {
        some: { userId: teacher.id }
      }
    },
    include: {
      collectionSkripts: {
        include: {
          skript: {
            include: {
              pages: {
                orderBy: { order: 'asc' },
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  content: true,
                  order: true,
                  isPublished: true
                }
              }
            }
          }
        },
        orderBy: { order: 'asc' }
      }
    }
  })

  if (!fullCollection) {
    notFound()
  }

  const collectionSkript = fullCollection.collectionSkripts.find(cs => cs.skript.slug === skriptSlug)
  if (!collectionSkript) {
    notFound()
  }

  const page = collectionSkript.skript.pages.find(p => p.slug === pageSlug)
  if (!page) {
    notFound()
  }

  const collection = {
    id: fullCollection.id,
    title: fullCollection.title,
    slug: fullCollection.slug,
    description: fullCollection.description,
    isPublished: fullCollection.isPublished,
  }

  const skript = {
    id: collectionSkript.skript.id,
    title: collectionSkript.skript.title,
    slug: collectionSkript.skript.slug,
    isPublished: collectionSkript.skript.isPublished,
  }

  const allPages = collectionSkript.skript.pages

  // Check what's unpublished
  const isPreviewMode = !fullCollection.isPublished || !collectionSkript.skript.isPublished || !page.isPublished

  // If everything is published, redirect to the public URL
  if (!isPreviewMode) {
    redirect(`/${domain}/${collectionSlug}/${skriptSlug}/${pageSlug}`)
  }

  // Build site structure for navigation (show all pages for author)
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

  // Prepare teacher data
  const teacherForLayout = {
    name: teacher.name || teacher.pageSlug || 'Unknown',
    pageSlug: teacher.pageSlug || domain,
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${collectionSlug}/${skriptSlug}/${pageSlug}`

  return (
    <PublicSiteLayout
      teacher={teacherForLayout}
      siteStructure={siteStructure}
      currentPath={currentPath}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      pageId={page.id}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10">
        {/* Preview mode indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 mb-4 text-sm rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
          <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>
            <span className="font-semibold">Preview:</span>
            {!collection.isPublished && ' Collection'}
            {!skript.isPublished && ' Skript'}
            {!page.isPublished && ' Page'}
            {' not published. Only you can see this.'}
          </span>
        </div>

        <article className="prose-theme">
          <AnnotationWrapper pageId={page.id} content={page.content}>
            <ServerMarkdownRenderer
              content={page.content}
              skriptId={skript.id}
              pageId={page.id}
            />
          </AnnotationWrapper>
        </article>

        <div className="mt-8 pt-8 border-t border-border">
          <ExportPDF
            content={page.content}
            title={page.title}
            author={teacherForLayout.name}
          />
        </div>
      </div>
    </PublicSiteLayout>
  )
}
