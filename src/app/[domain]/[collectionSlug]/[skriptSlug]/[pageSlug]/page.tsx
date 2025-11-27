import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'
import { AnnotatableContent } from '@/components/public/annotatable-content'
import { ExportPDF } from '@/components/public/export-pdf'
import { checkPagePermissions } from '@/lib/permissions'
// Debug overlay removed after fixing iPad layout issue
// import { LayoutDebug } from '@/components/debug/layout-debug'
// import { Comments } from '@/components/public/comments'
import type { Metadata } from 'next'
import {
  getTeacherByUsernameDeduped,
  getPublishedPage,
  getAllPublishedCollections,
} from '@/lib/cached-queries'

interface PageProps {
  params: Promise<{
    domain: string
    collectionSlug: string
    skriptSlug: string
    pageSlug: string
  }>
}

// Enable ISR - pages are cached until explicitly invalidated via revalidateTag
export const revalidate = false // Cache indefinitely, invalidate on content update
export const dynamicParams = true // Allow new params to be generated on-demand

// Generate metadata for SEO (uses cached queries)
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, collectionSlug, skriptSlug, pageSlug } = await params

  try {
    // Use cached teacher lookup
    const teacher = await getTeacherByUsernameDeduped(domain)
    if (!teacher) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Use cached content lookup (only returns published content)
    const content = await getPublishedPage(
      teacher.id,
      collectionSlug,
      skriptSlug,
      pageSlug,
      domain
    )

    if (!content) {
      // Content not found or not published - return generic metadata
      // (unpublished preview pages don't need SEO metadata)
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.',
        robots: 'noindex'
      }
    }

    const title = `${content.page.title} | ${teacher.name || 'Eduskript'}`
    const description = content.collection.description || `${content.page.title} by ${teacher.name}`

    return {
      title,
      description,
      authors: [{ name: teacher.name || 'Unknown' }],
      openGraph: {
        title,
        description,
        type: 'article',
        siteName: teacher.name || 'Eduskript',
        url: `https://${domain}/${collectionSlug}/${skriptSlug}/${pageSlug}`
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

export default async function PublicPage({ params }: PageProps) {
  const { domain, collectionSlug, skriptSlug, pageSlug } = await params

  // Filter out obviously invalid domain values (browser/system requests)
  const invalidDomains = ['.well-known', '_next', 'api', 'favicon', 'robots', 'sitemap', 'apple-touch-icon', 'manifest']
  if (invalidDomains.some(invalid => domain.startsWith(invalid) || domain.includes('.'))) {
    notFound()
  }

  // First, try to get the teacher from cache (fast path)
  const teacher = await getTeacherByUsernameDeduped(domain)
  if (!teacher) {
    notFound()
  }

  // Try cached published content first (fast path for public visitors)
  const cachedContent = await getPublishedPage(
    teacher.id,
    collectionSlug,
    skriptSlug,
    pageSlug,
    domain // username for cache tagging
  )

  // Variables for render
  let collection: typeof cachedContent extends null ? never : NonNullable<typeof cachedContent>['collection'] & { isPublished: boolean }
  let skript: typeof cachedContent extends null ? never : NonNullable<typeof cachedContent>['skript'] & { isPublished: boolean }
  let page: NonNullable<typeof cachedContent>['page']
  let allPages: NonNullable<typeof cachedContent>['allPages']
  let isAuthor = false
  let isPreviewMode = false
  let canEdit = false

  if (cachedContent) {
    // Published content found in cache - use it
    collection = cachedContent.collection as typeof collection
    skript = cachedContent.skript as typeof skript
    page = cachedContent.page
    allPages = cachedContent.allPages
  } else {
    // Content not in cache - might be unpublished, check auth
    const session = await getServerSession(authOptions)
    isAuthor = session?.user?.email === teacher.email

    if (!isAuthor) {
      // Not the author and content not published - 404
      notFound()
    }

    // Author viewing unpublished content - fetch directly
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

    const foundPage = collectionSkript.skript.pages.find(p => p.slug === pageSlug)
    if (!foundPage) {
      notFound()
    }

    collection = {
      id: fullCollection.id,
      title: fullCollection.title,
      slug: fullCollection.slug,
      description: fullCollection.description,
      isPublished: fullCollection.isPublished,
    }
    skript = {
      id: collectionSkript.skript.id,
      title: collectionSkript.skript.title,
      slug: collectionSkript.skript.slug,
      isPublished: collectionSkript.skript.isPublished,
    }
    page = foundPage
    allPages = collectionSkript.skript.pages
    isPreviewMode = !fullCollection.isPublished || !collectionSkript.skript.isPublished || !foundPage.isPublished
  }

  // Check if current user can edit the page
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    // Fetch permissions for this page
    const pageWithAuthors = await prisma.page.findUnique({
      where: { id: page.id },
      include: {
        authors: { include: { user: true } },
        skript: {
          include: {
            authors: { include: { user: true } },
            collectionSkripts: {
              include: {
                collection: {
                  include: {
                    authors: { include: { user: true } }
                  }
                }
              }
            }
          }
        }
      }
    })

    if (pageWithAuthors) {
      const collectionAuthors = pageWithAuthors.skript.collectionSkripts
        .filter(cs => cs.collection !== null)
        .flatMap(cs => cs.collection!.authors)
      const permissions = checkPagePermissions(
        session.user.id,
        pageWithAuthors.authors,
        pageWithAuthors.skript.authors,
        collectionAuthors
      )
      canEdit = permissions.canEdit
    }
  }

  // Build site structure for navigation
  const siteStructure = [{
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    skripts: [{
      id: skript.id,
      title: skript.title,
      slug: skript.slug,
      pages: allPages
        .filter(p => isAuthor || p.isPublished)
        .map(p => ({
          id: p.id,
          title: p.title,
          slug: p.slug
        }))
    }]
  }]

  // Fetch full site structure if sidebar behavior is "full" (cached)
  let fullSiteStructure = undefined
  if (teacher.sidebarBehavior === 'full') {
    const allCollections = await getAllPublishedCollections(teacher.id, domain)

    fullSiteStructure = allCollections.map(col => ({
      id: col.id,
      title: col.title,
      slug: col.slug,
      skripts: col.collectionSkripts
        .map(cs => cs.skript)
        .filter(s => s.isPublished)
        .map(s => ({
          id: s.id,
          title: s.title,
          slug: s.slug,
          pages: s.pages
        }))
    }))
  }

  // Prepare teacher data for the layout component
  const teacherForLayout = {
    name: teacher.name || teacher.username || 'Unknown',
    username: teacher.username || domain,
    bio: teacher.bio || undefined,
    title: teacher.title || undefined
  }

  const currentPath = `/${collectionSlug}/${skriptSlug}/${pageSlug}`
  const editUrl = canEdit
    ? `/dashboard/collections/${collectionSlug}/skripts/${skriptSlug}/pages/${pageSlug}/edit`
    : undefined

  return (
    <PublicSiteLayout
      teacher={teacherForLayout}
      siteStructure={siteStructure}
      currentPath={currentPath}
      fullSiteStructure={fullSiteStructure}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      editUrl={editUrl}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10" style={{ maxWidth: 'min(1280px, calc(100vw - 48px))', marginLeft: 'auto', marginRight: 'auto' }}>
        {/* Preview mode indicator for unpublished content */}
        {isPreviewMode && isAuthor && (
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
        )}

        <article className="prose-theme">
          <AnnotatableContent
            pageId={page.id}
            content={page.content}
            domain={domain}
            skriptId={skript.id}
          />
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
