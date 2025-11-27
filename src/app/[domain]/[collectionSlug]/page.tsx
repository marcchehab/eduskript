import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'
import { getNavigationUrl } from '@/lib/utils'
import { headers } from 'next/headers'
import { getTeacherByUsernameDeduped, getPublishedCollection } from '@/lib/cached-queries'

// Enable ISR - pages are cached until explicitly invalidated
export const revalidate = false
export const dynamicParams = true

interface CollectionPreviewProps {
  params: Promise<{
    domain: string
    collectionSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: CollectionPreviewProps): Promise<Metadata> {
  const { domain, collectionSlug } = await params
  
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

    return {
      title: `${collection.title} - Preview | ${teacher.name || domain}`,
      description: collection.description || `Preview of ${collection.title} by ${teacher.name || domain}`,
      robots: 'noindex, nofollow' // Prevent search engines from indexing previews
    }
  } catch (error) {
    console.error('Error generating metadata for collection preview:', error)
    return {
      title: 'Collection Preview',
      description: 'Preview mode for collection content'
    }
  }
}

interface Teacher {
  id: string
  name: string | null
  email: string | null
  title: string | null
  bio: string | null
  username: string | null
  sidebarBehavior?: string | null
  typographyPreference?: string | null
}

interface CollectionPage {
  id: string
  title: string
  slug: string
  order: number
  isPublished: boolean
}

interface CollectionSkript {
  id: string
  title: string
  slug: string
  isPublished: boolean
  pages: CollectionPage[]
}

interface CollectionSkriptJunction {
  order: number
  skript: CollectionSkript
}

interface CollectionWithSkripts {
  id: string
  title: string
  slug: string
  description: string | null
  isPublished: boolean
  collectionSkripts: CollectionSkriptJunction[]
}

export default async function CollectionPreviewPage({ params }: CollectionPreviewProps) {
  const { domain, collectionSlug } = await params

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

  // Declare variables outside try block so they can be used in redirect logic
  let teacher: Teacher | null = null
  let collection: CollectionWithSkripts | null = null
  let isAuthor = false

  try {
    // Find the teacher
    teacher = await prisma.user.findUnique({
      where: { username: domain }
    })

    if (!teacher) {
      notFound()
    }

    // Find the collection
    collection = await prisma.collection.findFirst({
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
          select: {
            order: true,
            skript: {
              select: {
                id: true,
                title: true,
                slug: true,
                isPublished: true,
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
          },
          orderBy: { order: 'asc' }
        }
      }
    })

    if (!collection) {
      notFound()
    }

    // Authorization check: Only the author can preview unpublished collections
    isAuthor = session?.user?.email === teacher.email
    
    if (!collection.isPublished && !isAuthor) {
      // If collection is not published and user is not the author, show access denied
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center max-w-md mx-auto p-6">
            <h1 className="text-2xl font-bold text-foreground mb-4">
              Access Denied
            </h1>
            <p className="text-muted-foreground mb-6">
              This collection is not published yet. Only the author can preview unpublished content.
            </p>
            <button 
              onClick={() => window.history.back()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Go Back
            </button>
          </div>
        </div>
      )
    }

  } catch (error) {
    console.error('Error loading collection preview:', error)
    notFound()
  }

  // Find the first available page to redirect to (outside try/catch to allow redirect to work)
  const firstCollectionSkript = collection.collectionSkripts.find((cs: CollectionSkriptJunction) =>
    isAuthor || cs.skript.isPublished
  )

  const firstSkript = firstCollectionSkript?.skript
  const firstPage = firstSkript?.pages.find((page: CollectionPage) =>
    isAuthor || page.isPublished
  )

  if (firstPage && firstSkript) {
    const redirectUrl = hasSubdomain
      ? `/${collectionSlug}/${firstSkript.slug}/${firstPage.slug}`
      : `/${domain}/${collectionSlug}/${firstSkript.slug}/${firstPage.slug}`
    console.log(`Redirecting to: ${redirectUrl}`)
    // Redirect to the first available page
    redirect(redirectUrl)
  }

  // Build site structure for navigation
  const siteStructure = [{
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    isPublished: collection.isPublished,
    skripts: collection.collectionSkripts.map(cs => ({
      id: cs.skript.id,
      title: cs.skript.title,
      slug: cs.skript.slug,
      isPublished: cs.skript.isPublished,
      pages: cs.skript.pages.map((page: CollectionPage) => ({
        id: page.id,
        title: page.title,
        slug: page.slug,
        isPublished: page.isPublished
      }))
    }))
  }]

  // Prepare teacher data for the layout component
  const teacherForLayout = {
    name: teacher.name || teacher.username || 'Unknown',
    username: teacher.username || domain,
    bio: teacher.bio || undefined,
    title: teacher.title || undefined
  }

    // If no pages are available, show collection overview
    return (
      <PublicSiteLayout
        teacher={teacherForLayout}
        siteStructure={siteStructure}
        currentPath={`/${collectionSlug}`}
        sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
        typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      >
        <div className="max-w-4xl mx-auto p-6">
          <div className="mb-6">
            {!collection.isPublished && isAuthor && (
              <div className="flex items-center gap-2 px-3 py-1.5 mb-4 text-sm rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
                <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span><span className="font-semibold">Preview:</span> Collection not published. Only you can see this.</span>
              </div>
            )}
            
            <h1 className="text-4xl font-bold text-foreground mb-4">
              {collection.title}
            </h1>
            
            {collection.description && (
              <p className="text-xl text-muted-foreground mb-8">
                {collection.description}
              </p>
            )}
          </div>

          {/* Collection Overview */}
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-semibold mb-4">Contents</h2>
              {collection.collectionSkripts.length > 0 ? (
                <div className="space-y-4">
                  {collection.collectionSkripts.map((cs: CollectionSkriptJunction, skriptIndex: number) => {
                    const skript = cs.skript
                    const isSkriptVisible = isAuthor || skript.isPublished
                    
                    if (!isSkriptVisible) return null
                    
                    return (
                      <div key={skript.id} className="border border-border rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-2 flex items-center">
                          <span className="mr-2 text-muted-foreground">
                            {skriptIndex + 1}.
                          </span>
                          {skript.title}
                          {!skript.isPublished && isAuthor && (
                            <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded">
                              Draft
                            </span>
                          )}
                        </h3>
                        
                        {skript.pages.length > 0 ? (
                          <ul className="space-y-1 ml-6">
                            {skript.pages.map((page: CollectionPage, pageIndex: number) => {
                              const isPageVisible = isAuthor || page.isPublished
                              
                              if (!isPageVisible) return null
                              
                              return (
                                <li key={page.id} className="text-muted-foreground">
                                  <a 
                                    href={getNavigationUrl(domain, `/${collectionSlug}/${skript.slug}/${page.slug}`)}
                                    className="hover:text-foreground hover:underline flex items-center"
                                  >
                                    <span className="mr-2">
                                      {skriptIndex + 1}.{pageIndex + 1}
                                    </span>
                                    {page.title}
                                    {!page.isPublished && isAuthor && (
                                      <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded">
                                        Draft
                                      </span>
                                    )}
                                  </a>
                                </li>
                              )
                            })}
                          </ul>
                        ) : (
                          <p className="text-muted-foreground ml-6">No pages yet</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  This collection doesn&apos;t have any skripts yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </PublicSiteLayout>
    )
}
