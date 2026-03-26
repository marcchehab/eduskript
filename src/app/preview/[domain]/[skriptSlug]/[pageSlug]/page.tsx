import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getSkriptForPreview } from '@/lib/cached-queries'
import type { Metadata } from 'next'

interface PageProps {
  params: Promise<{
    domain: string
    skriptSlug: string
    pageSlug: string
  }>
}

// Preview routes are always dynamic (auth required)
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pageSlug } = await params

  return {
    title: `Preview: ${pageSlug}`,
    description: 'Draft preview - not published',
    robots: 'noindex, nofollow'
  }
}

export default async function PreviewPage({ params }: PageProps) {
  const { domain, skriptSlug, pageSlug } = await params

  // Auth required for preview
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect('/auth/signin')
  }
  const userId = session.user.id

  // Get teacher by username
  const teacher = await prisma.user.findFirst({
    where: { pageSlug: domain }
  })

  if (!teacher) {
    notFound()
  }

  // Only the author can view previews
  const isAuthor = userId === teacher.id
  if (!isAuthor) {
    notFound()
  }

  // Fetch skript directly by unique slug (includes unpublished)
  const skriptData = await getSkriptForPreview(teacher.id, skriptSlug)
  if (!skriptData) {
    notFound()
  }

  const page = skriptData.pages.find(p => p.slug === pageSlug)
  if (!page) {
    notFound()
  }

  const collectionSkript = skriptData.collectionSkripts[0]
  const collection = collectionSkript?.collection

  const skript = {
    id: skriptData.id,
    title: skriptData.title,
    slug: skriptData.slug,
    isPublished: skriptData.isPublished,
  }

  const allPages = skriptData.pages

  // Check what's unpublished (collections no longer have publishing status)
  const isPreviewMode = !skriptData.isPublished || !page.isPublished

  // Build site structure for navigation (show all pages for author)
  const siteStructure = collection
    ? [{
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
    : [{
        id: 'standalone',
        title: skript.title,
        slug: skript.slug,
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

  const currentPath = `/${skriptSlug}/${pageSlug}`

  return (
    <PublicSiteLayout
      teacher={teacherForLayout}
      siteStructure={siteStructure}
      currentPath={currentPath}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      pageId={page.id}
    >
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        {/* Preview mode indicator — only shown when something is unpublished */}
        {isPreviewMode && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-4 text-sm rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>
              <span className="font-semibold">Preview:</span>
              {!skript.isPublished && ' Skript'}
              {!page.isPublished && ' Page'}
              {' not published. Only you can see this.'}
            </span>
          </div>
        )}

        <article className="prose-theme">
          <AnnotationWrapper pageId={page.id} content={page.content}>
            <ServerMarkdownRenderer
              content={page.content}
              skriptId={skript.id}
              pageId={page.id}
            />
          </AnnotationWrapper>
        </article>

      </div>
    </PublicSiteLayout>
  )
}
