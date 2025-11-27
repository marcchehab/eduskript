import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'
import { PublicSiteLayout } from '@/components/public/layout'
import { AnnotatableContent } from '@/components/public/annotatable-content'
import { headers } from 'next/headers'
import { getTeacherByUsernameDeduped, getAllPublishedCollections } from '@/lib/cached-queries'

// Enable ISR - pages are cached until explicitly invalidated
export const revalidate = false
export const dynamicParams = true

interface SkriptPreviewProps {
  params: Promise<{
    domain: string
    collectionSlug: string
    skriptSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: SkriptPreviewProps): Promise<Metadata> {
  const { domain, collectionSlug, skriptSlug } = await params
  
  try {
    // Find the teacher and collection
    const teacher = await prisma.user.findUnique({
      where: { username: domain },
      select: { id: true, name: true, title: true }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher profile could not be found.'
      }
    }

    const collection = await prisma.collection.findFirst({
      where: {
        slug: collectionSlug,
        authors: {
          some: {
            userId: teacher.id
          }
        }
      },
      select: { title: true, description: true }
    })

    if (!collection) {
      return {
        title: 'Collection Not Found',
        description: 'The requested collection could not be found.'
      }
    }

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        collectionSkripts: {
          some: {
            collection: {
              slug: collectionSlug,
              authors: {
                some: {
                  userId: teacher.id
                }
              }
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
      title: `${skript.title} - ${collection.title} | ${teacher.name || domain}`,
      description: `${skript.title} from ${collection.title} by ${teacher.name || domain}`,
      robots: 'noindex, nofollow' // Prevent search engines from indexing previews
    }
  } catch (error) {
    console.error('Error generating metadata for skript preview:', error)
    return {
      title: 'Skript Preview',
      description: 'Preview mode for skript content'
    }
  }
}

interface CollectionPage {
  id: string
  title: string
  slug: string
  order: number
  isPublished: boolean
}





export default async function SkriptPreviewPage({ params }: SkriptPreviewProps) {
  const { domain, collectionSlug, skriptSlug } = await params

  // Filter out obviously invalid domain values (browser/system requests)
  const invalidDomains = ['.well-known', '_next', 'api', 'favicon', 'robots', 'sitemap', 'apple-touch-icon', 'manifest']
  if (invalidDomains.some(invalid => domain.startsWith(invalid) || domain.includes('.'))) {
    notFound()
  }

  const session = await getServerSession(authOptions)

  // Check request headers
  const headersList = await headers()
  const hostname = headersList.get('host') || ''
  const hostWithoutPort = hostname.split(':')[0]
  const parts = hostWithoutPort.split('.')
  const hasSubdomain = (parts.length > 1 && parts[parts.length - 1] === 'localhost') ||
                      (parts.length > 2 && parts[parts.length - 2] === 'eduskript')

  try {
    // Find the teacher
    const teacher = await prisma.user.findUnique({
      where: { username: domain },
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        bio: true,
        username: true
      }
    })

    if (!teacher) {
      notFound()
    }

    // Check if current user is the author
    const isAuthor = session?.user?.email === teacher.email

    // Find the collection with the specific skript
    const collection = await prisma.collection.findFirst({
      where: {
        slug: collectionSlug,
        authors: {
          some: {
            userId: teacher.id
          }
        }
      },
      include: {
        collectionSkripts: {
          where: {
            skript: {
              slug: skriptSlug
            }
          },
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

    // Authorization check: Only the author can preview unpublished collections
    if (!collection.isPublished && !isAuthor) {
      notFound()
    }

    const collectionSkript = collection.collectionSkripts[0]
    if (!collectionSkript) {
      notFound()
    }

    const skript = collectionSkript.skript

    // Authorization check for skript
    if (!skript.isPublished && !isAuthor) {
      notFound()
    }

    // Check for frontpage (published for visitors, any for authors)
    const frontPage = await prisma.frontPage.findFirst({
      where: {
        skriptId: skript.id,
        ...(isAuthor ? {} : { isPublished: true })
      }
    })

    // Show frontpage if: has content, OR author viewing (even empty/unpublished)
    const showFrontpage = frontPage?.content || isAuthor

    if (showFrontpage) {
      // Get all published collections for sidebar
      const rawCollections = await getAllPublishedCollections(teacher.id, domain)

      // Transform to SiteStructure format
      const collections = rawCollections.map(c => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        skripts: c.collectionSkripts.map(cs => ({
          id: cs.skript.id,
          title: cs.skript.title,
          slug: cs.skript.slug,
          pages: cs.skript.pages
        }))
      }))

      // Get teacher's preferences
      const teacherPrefs = await prisma.user.findUnique({
        where: { id: teacher.id },
        select: { sidebarBehavior: true, typographyPreference: true }
      })

      const teacherData = {
        name: teacher.name || 'Teacher',
        username: teacher.username || '',
        bio: teacher.bio || undefined,
        title: teacher.title || undefined
      }

      // Get available pages for navigation
      const availablePages = skript.pages.filter((page: CollectionPage) =>
        isAuthor || page.isPublished
      )

      // Check if current user can edit this frontpage
      const canEdit = isAuthor
      const editUrl = canEdit ? `/dashboard/collections/${collectionSlug}/skripts/${skriptSlug}/frontpage` : undefined

      // Check if this is a preview (unpublished)
      const isPreviewMode = isAuthor && frontPage && !frontPage.isPublished

      return (
        <PublicSiteLayout
          teacher={teacherData}
          siteStructure={collections}
          rootSkripts={[]}
          sidebarBehavior={teacherPrefs?.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
          typographyPreference={teacherPrefs?.typographyPreference as 'modern' | 'classic' || 'modern'}
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

            {/* Frontpage content or empty state for authors */}
            {frontPage?.content ? (
              <article className="prose-theme">
                <AnnotatableContent
                  pageId={frontPage.id}
                  content={frontPage.content}
                  domain={domain}
                  skriptId={skript.id}
                />
              </article>
            ) : isAuthor ? (
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
    const firstPage = skript.pages.find((page: CollectionPage) =>
      isAuthor || page.isPublished
    )

    if (firstPage) {
      // Redirect to the first available page
      const redirectUrl = hasSubdomain
        ? `/${collectionSlug}/${skriptSlug}/${firstPage.slug}`
        : `/${domain}/${collectionSlug}/${skriptSlug}/${firstPage.slug}`
      console.log('Redirecting to:', redirectUrl)
      return <SkriptRedirect redirectUrl={redirectUrl} />
    }

    // If no pages are available, redirect back to collection
    const redirectUrl = hasSubdomain
      ? `/${collectionSlug}`
      : `/${domain}/${collectionSlug}`
    console.log('Redirecting to:', redirectUrl)
    return <SkriptRedirect redirectUrl={redirectUrl} />

  } catch (error) {
    console.error('Error loading skript preview:', error)
    notFound()
  }
} 