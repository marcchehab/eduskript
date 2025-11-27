import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { PublicSiteLayout } from '@/components/public/layout'
import { AnnotatableContent } from '@/components/public/annotatable-content'
import {
  getTeacherByUsernameDeduped,
  getTeacherWithLayout,
  getTeacherHomepageContent,
} from '@/lib/cached-queries'
import { prisma } from '@/lib/prisma'

// Enable ISR - pages are cached until explicitly invalidated
export const revalidate = false
export const dynamicParams = true

interface DomainIndexProps {
  params: Promise<{
    domain: string
  }>
}

// Generate metadata for SEO (uses cached queries)
export async function generateMetadata({ params }: DomainIndexProps): Promise<Metadata> {
  const { domain } = await params

  try {
    const teacher = await getTeacherByUsernameDeduped(domain)

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher could not be found.'
      }
    }

    const title = teacher.name || 'Eduskript'
    const description = teacher.bio || `Educational content by ${teacher.name}`

    return {
      title,
      description,
      authors: [{ name: teacher.name || 'Unknown' }],
      openGraph: {
        title,
        description,
        type: 'website',
        siteName: teacher.name || 'Eduskript',
        url: `https://${domain}`
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

export default async function DomainIndex({ params }: DomainIndexProps) {
  const { domain } = await params

  // Filter out obviously invalid domain values (browser/system requests)
  const invalidDomains = ['.well-known', '_next', 'api', 'favicon', 'robots', 'sitemap', 'apple-touch-icon', 'manifest']
  if (invalidDomains.some(invalid => domain.startsWith(invalid) || domain.includes('.'))) {
    notFound()
  }

  // Get teacher with layout using cached query
  const teacher = await getTeacherWithLayout(domain)

  if (!teacher) {
    notFound()
  }

  // Check if current user is the owner
  const session = await getServerSession(authOptions)
  const isOwner = session?.user?.id === teacher.id

  // Check for frontpage (published for visitors, any for owner)
  const frontPage = await prisma.frontPage.findFirst({
    where: {
      userId: teacher.id,
      ...(isOwner ? {} : { isPublished: true })
    }
  })

  // Check if this is a preview (unpublished)
  const isPreviewMode = isOwner && frontPage && !frontPage.isPublished

  // Get page layout items
  const pageItems = teacher.pageLayout?.items || []

  // Fetch homepage content using cached query
  const { collections, rootSkripts } = pageItems.length > 0
    ? await getTeacherHomepageContent(
        teacher.id,
        domain,
        pageItems.map(item => ({ type: item.type, contentId: item.contentId }))
      )
    : { collections: [], rootSkripts: [] }

  const teacherData = {
    name: teacher.name || 'Teacher',
    username: teacher.username || '',
    bio: teacher.bio || undefined,
    title: teacher.title || undefined
  }

  const editUrl = isOwner ? '/dashboard/frontpage' : undefined

  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={collections}
      rootSkripts={rootSkripts}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      editUrl={editUrl}
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
            <AnnotatableContent
              pageId={frontPage.id}
              content={frontPage.content}
              domain={domain}
            />
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
