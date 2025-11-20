import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'
import { AnnotatableContent } from '@/components/public/annotatable-content'
import { ExportPDF } from '@/components/public/export-pdf'
import { Comments } from '@/components/public/comments'
import type { Metadata } from 'next'
import { headers } from 'next/headers'

interface PageProps {
  params: Promise<{
    domain: string
    collectionSlug: string
    skriptSlug: string
    pageSlug: string
  }>
}

// Enable ISR with on-demand regeneration
export const revalidate = 0 // No caching for preview mode
export const dynamic = 'force-dynamic' // Force dynamic rendering for auth checks
export const dynamicParams = true // Allow new params to be generated on-demand

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, collectionSlug, skriptSlug, pageSlug } = await params

  try {
    const session = await getServerSession(authOptions)
    
    // Find teacher by subdomain first
    const teacher = await prisma.user.findFirst({
      where: { subdomain: domain },
      select: { 
        id: true, 
        name: true, 
        email: true,
        title: true, 
        bio: true, 
        subdomain: true 
      }
    })

    if (!teacher) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Check if current user is the author
    const isAuthor = session?.user?.email === teacher.email

    // Find the collection
    const collection = await prisma.collection.findFirst({
      where: {
        slug: collectionSlug,
        authors: {
          some: {
            userId: teacher.id
          }
        }
      },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        isPublished: true
      }
    })

    if (!collection) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Authorization check for collection
    if (!collection.isPublished && !isAuthor) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Find the skript through the collection
    const collectionSkript = await prisma.collectionSkript.findFirst({
      where: {
        collectionId: collection.id,
        skript: {
          slug: skriptSlug
        }
      },
      include: {
        skript: {
          select: {
            id: true,
            title: true,
            slug: true,
            isPublished: true
          }
        }
      }
    })
    
    const skript = collectionSkript?.skript

    if (!skript) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Authorization check for skript
    if (!skript.isPublished && !isAuthor) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Find the page
    const page = await prisma.page.findFirst({
      where: {
        skriptId: skript.id,
        slug: pageSlug
      },
      select: {
        id: true,
        title: true,
        slug: true,
        isPublished: true
      }
    })

    if (!page) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Authorization check for page
    if (!page.isPublished && !isAuthor) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    const title = `${page.title} | ${teacher.name || 'Eduskript'}`
    const description = collection.description || `${page.title} by ${teacher.name}`

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
  const session = await getServerSession(authOptions)
  
  // Check if we're on a subdomain by examining the Host header
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const hostname = host.split(':')[0]
  const isOnSubdomain = hostname !== 'localhost' && hostname.endsWith('.localhost')

  try {
    // Find teacher by subdomain
    const teacher = await prisma.user.findFirst({
      where: { subdomain: domain },
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        bio: true,
        subdomain: true,
        sidebarBehavior: true
      }
    })

    if (!teacher) {
      console.error('❌ Teacher not found, calling notFound()')
      notFound()
    }

    // Check if current user is the author
    const isAuthor = session?.user?.email === teacher.email

    // Find the collection, skript, and page
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

    if (!collection) {
      notFound()
    }

    // Authorization check for collection
    if (!collection.isPublished && !isAuthor) {
      notFound()
    }

    const collectionSkript = collection.collectionSkripts.find(cs => cs.skript.slug === skriptSlug)
    if (!collectionSkript) {
      notFound()
    }
    
    const skript = collectionSkript.skript

    // Authorization check for skript
    if (!skript.isPublished && !isAuthor) {
      notFound()
    }

    const page = skript.pages.find(p => p.slug === pageSlug)
    if (!page) {
      notFound()
    }

    // Authorization check for page
    if (!page.isPublished && !isAuthor) {
      notFound()
    }

    // Build site structure for navigation
    const siteStructure = [{
      id: collection.id,
      title: collection.title,
      slug: collection.slug,
      skripts: collection.collectionSkripts
        .map(cs => cs.skript)
        .filter(ch => isAuthor || ch.isPublished) // Show all skripts to author, only published to others
        .map(ch => ({
          id: ch.id,
          title: ch.title,
          slug: ch.slug,
          pages: ch.pages
            .filter(p => isAuthor || p.isPublished) // Show all pages to author, only published to others
            .map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug
            }))
        }))
    }]
    
    // Fetch full site structure if sidebar behavior is "full"
    let fullSiteStructure = undefined
    if (teacher.sidebarBehavior === 'full') {
      const allCollections = await prisma.collection.findMany({
        where: {
          authors: {
            some: {
              userId: teacher.id
            }
          },
          isPublished: true
        },
        include: {
          collectionSkripts: {
            include: {
              skript: {
                include: {
                  pages: {
                    where: { isPublished: true },
                    orderBy: { order: 'asc' },
                    select: {
                      id: true,
                      title: true,
                      slug: true
                    }
                  }
                }
              }
            },
            orderBy: { order: 'asc' }
          }
        },
        orderBy: { updatedAt: 'desc' }
      })
      
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
      name: teacher.name || teacher.subdomain || 'Unknown',
      subdomain: teacher.subdomain || domain,
      bio: teacher.bio || undefined,
      title: teacher.title || undefined
    }

    const currentPath = `/${collectionSlug}/${skriptSlug}/${pageSlug}`

    return (
      <PublicSiteLayout
        teacher={teacherForLayout}
        siteStructure={siteStructure}
        currentPath={currentPath}
        fullSiteStructure={fullSiteStructure}
        sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      >
        <div id="paper" className="max-w-5xl mx-auto py-24 px-4 sm:px-8 md:px-12 lg:px-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10">
          {/* Preview mode indicator for unpublished content */}
          {(!collection.isPublished || !skript.isPublished || !page.isPublished) && isAuthor && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Preview Mode:</strong>
                    {!collection.isPublished && ' Collection is not published.'}
                    {!skript.isPublished && ' Skript is not published.'}
                    {!page.isPublished && ' Page is not published.'}
                    {' Only you can see this content.'}
                  </p>
                </div>
              </div>
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

          <div className="mt-8">
            <Comments
              pageId={page.id}
              pageTitle={page.title}
            />
          </div>
        </div>
      </PublicSiteLayout>
    )

  } catch (error) {
    console.error('Error loading page:', error)
    notFound()
  }
}
