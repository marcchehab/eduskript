import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'
import { processMarkdown } from '@/lib/markdown'
import { Breadcrumb } from '@/components/public/breadcrumb'
import { ExportPDF } from '@/components/public/export-pdf'
import { Comments } from '@/components/public/comments'
import { Edit } from 'lucide-react'
import type { Metadata } from 'next'
import { listFiles } from '@/lib/file-storage'
import { headers } from 'next/headers'

interface PageProps {
  params: Promise<{
    domain: string
    collectionSlug: string
    chapterSlug: string
    pageSlug: string
  }>
}

// Enable ISR with on-demand regeneration
export const revalidate = 0 // No caching for preview mode
export const dynamic = 'force-dynamic' // Force dynamic rendering for auth checks
export const dynamicParams = true // Allow new params to be generated on-demand

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, collectionSlug, chapterSlug, pageSlug } = await params

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

    // Find the chapter
    const chapter = await prisma.chapter.findUnique({
      where: {
        collectionId_slug: {
          collectionId: collection.id,
          slug: chapterSlug
        }
      },
      select: {
        id: true,
        title: true,
        slug: true,
        isPublished: true
      }
    })

    if (!chapter) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Authorization check for chapter
    if (!chapter.isPublished && !isAuthor) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Find the page
    const page = await prisma.page.findUnique({
      where: {
        chapterId_slug: {
          chapterId: chapter.id,
          slug: pageSlug
        }
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
        url: `https://${domain}/${collectionSlug}/${chapterSlug}/${pageSlug}`
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
  const { domain, collectionSlug, chapterSlug, pageSlug } = await params
  const session = await getServerSession(authOptions)
  
  // Debug logging
  console.log('🔍 PublicPage Debug:', { domain, collectionSlug, chapterSlug, pageSlug })
  
  // Check if we're on a subdomain by examining the Host header
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const hostname = host.split(':')[0]
  const isOnSubdomain = hostname !== 'localhost' && hostname.endsWith('.localhost')

  console.log('🌐 Host info:', { host, hostname, isOnSubdomain })

  try {
    // Find teacher by subdomain
    console.log('👨‍🏫 Looking for teacher with subdomain:', domain)
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

    console.log('👨‍🏫 Teacher found:', teacher ? `${teacher.name} (${teacher.subdomain})` : 'null')

    if (!teacher) {
      console.log('❌ Teacher not found, calling notFound()')
      notFound()
    }

    // Check if current user is the author
    const isAuthor = session?.user?.email === teacher.email

    // Find the collection, chapter, and page
    console.log('📚 Looking for collection:', collectionSlug)
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
        chapters: {
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

    const chapter = collection.chapters.find(ch => ch.slug === chapterSlug)
    if (!chapter) {
      notFound()
    }

    // Authorization check for chapter
    if (!chapter.isPublished && !isAuthor) {
      notFound()
    }

    const page = chapter.pages.find(p => p.slug === pageSlug)
    if (!page) {
      notFound()
    }

    // Authorization check for page
    if (!page.isPublished && !isAuthor) {
      notFound()
    }

    // Fetch chapter file list from local file system
    let fileList: Array<{
      id: string;
      name: string;
      url?: string;
      isDirectory?: boolean;
    }> = []
    if (isAuthor) {
      try {
        const files = await listFiles({
          chapterId: chapter.id,
          parentId: null, // Root level files
          userId: teacher.id
        })
        
        fileList = files.filter(file => !file.isDirectory) // Only include files, not directories
      } catch (error) {
        console.error('Error fetching files:', error)
        // Continue with empty file list if there's an error
      }
    }

    // Process the markdown content with proper context for image resolution
    const processedMarkdown = await processMarkdown(page.content, {
      domain: domain,
      chapterId: chapter.id,
      fileList
    })
    const processedContent = processedMarkdown.content

    // Build site structure for navigation
    const siteStructure = [{
      id: collection.id,
      title: collection.title,
      slug: collection.slug,
      chapters: collection.chapters
        .filter(ch => isAuthor || ch.isPublished) // Show all chapters to author, only published to others
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

    // Prepare teacher data for the layout component
    const teacherForLayout = {
      name: teacher.name || teacher.subdomain || 'Unknown',
      subdomain: teacher.subdomain || domain,
      bio: teacher.bio || undefined,
      title: teacher.title || undefined
    }

    const currentPath = `/${collectionSlug}/${chapterSlug}/${pageSlug}`

    return (
      <PublicSiteLayout
        teacher={teacherForLayout}
        siteStructure={siteStructure}
        currentPath={currentPath}
      >
        <div className="max-w-4xl mx-auto">
          {/* Preview mode indicator for unpublished content */}
          {(!collection.isPublished || !chapter.isPublished || !page.isPublished) && isAuthor && (
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
                    {!chapter.isPublished && ' Chapter is not published.'}
                    {!page.isPublished && ' Page is not published.'}
                    {' Only you can see this content.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <Breadcrumb
            items={[
              { title: collection.title, href: `/${domain}/${collectionSlug}` },
              { title: chapter.title, href: `/${domain}/${collectionSlug}/${chapterSlug}` },
              { title: page.title }
            ]}
            subdomain={domain}
            isOnSubdomain={isOnSubdomain}
          ><a
            href={`/dashboard/collections/${collection.slug}/chapters/${chapter.slug}/pages/${page.slug}/edit`}
            className="inline-flex items-center px-2 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors shadow-md"
          >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </a></Breadcrumb>

          <article className="prose-theme">
            <div dangerouslySetInnerHTML={{ __html: processedContent }} />
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
