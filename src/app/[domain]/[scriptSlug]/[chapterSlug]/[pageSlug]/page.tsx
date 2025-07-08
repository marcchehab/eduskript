import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'
import { processMarkdown } from '@/lib/markdown'
import { Breadcrumb } from '@/components/public/breadcrumb'
import { ExportPDF } from '@/components/public/export-pdf'
import { Comments } from '@/components/public/comments'
import type { Metadata } from 'next'

interface PageProps {
  params: Promise<{
    domain: string
    scriptSlug: string
    chapterSlug: string
    pageSlug: string
  }>
}

// Enable ISR with on-demand regeneration
export const revalidate = 60 // Revalidate every 60 seconds
export const dynamic = 'force-static' // Force static generation
export const dynamicParams = true // Allow new params to be generated on-demand

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, scriptSlug, chapterSlug, pageSlug } = await params
  
  try {
    const teacher = await prisma.user.findFirst({
      where: { subdomain: domain },
      include: {
        scripts: {
          where: { isPublished: true, slug: scriptSlug },
          include: {
            chapters: {
              where: { isPublished: true, slug: chapterSlug },
              include: {
                pages: {
                  where: { isPublished: true, slug: pageSlug }
                }
              }
            }
          }
        }
      }
    })

    if (!teacher) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    const script = teacher.scripts[0]
    const chapter = script?.chapters[0]
    const page = chapter?.pages[0]

    if (!page) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    const title = `${page.title} | ${teacher.name || 'Eduscript'}`
    const description = chapter.description || script.description || `${page.title} by ${teacher.name}`

    return {
      title,
      description,
      authors: [{ name: teacher.name || 'Unknown' }],
      openGraph: {
        title,
        description,
        type: 'article',
        siteName: teacher.name || 'Eduscript',
        url: `https://${domain}/${scriptSlug}/${chapterSlug}/${pageSlug}`
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
      title: 'Eduscript',
      description: 'Educational content platform'
    }
  }
}

export default async function PublicPage({ params }: PageProps) {
  const { domain, scriptSlug, chapterSlug, pageSlug } = await params

  try {
    // Find teacher by subdomain (custom domains support working at runtime)
    const teacher = await prisma.user.findFirst({
      where: {
        subdomain: domain
      },
      include: {
        scripts: {
          where: { isPublished: true },
          include: {
            chapters: {
              where: { isPublished: true },
              include: {
                pages: {
                  where: { isPublished: true },
                  orderBy: { order: 'asc' }
                }
              },
              orderBy: { order: 'asc' }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!teacher) {
      notFound()
    }

    // Find the specific page
    const script = teacher.scripts.find((s) => s.slug === scriptSlug)
    if (!script) {
      notFound()
    }

    const chapter = script.chapters.find((c) => c.slug === chapterSlug)
    if (!chapter) {
      notFound()
    }

    const page = chapter.pages.find((p) => p.slug === pageSlug)
    if (!page) {
      notFound()
    }

    // Process markdown content server-side with context for image path resolution
    const processedMarkdown = await processMarkdown(page.content || '', {
      domain: domain,
      chapterId: chapter.id
    })

    const pageData = {
      id: page.id,
      title: page.title,
      content: processedMarkdown.content,
      slug: page.slug,
      updatedAt: page.updatedAt.toISOString()
    }

    const chapterData = {
      title: chapter.title,
      slug: chapter.slug
    }

    const scriptData = {
      title: script.title,
      slug: script.slug
    }

    const teacherData = {
      name: teacher.name || 'Teacher',
      subdomain: teacher.subdomain || '',
      bio: teacher.bio || undefined,
      title: teacher.title || undefined
    }

    const breadcrumbItems = [
      { title: scriptData.title, href: `/${domain}/${scriptSlug}` },
      { title: chapterData.title, href: `/${domain}/${scriptSlug}/${chapterSlug}` },
      { title: pageData.title }
    ]

    return (
      <PublicSiteLayout 
        teacher={teacherData} 
        siteStructure={teacher.scripts} 
        currentPath={`/${script.slug}/${chapter.slug}/${page.slug}`}
      >
        <div className="max-w-4xl mx-auto">
          <Breadcrumb items={breadcrumbItems} subdomain={domain} />
          
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-4">
              {pageData.title}
            </h1>
          </div>
          
          <div 
            className="prose-theme"
            dangerouslySetInnerHTML={{ __html: pageData.content }}
          />

          <div className="mt-8">
            <ExportPDF 
              title={pageData.title} 
              content={pageData.content} 
              author={teacherData.name}
            />
          </div>

          <div className="mt-8">
            <Comments 
              pageId={pageData.id} 
              pageTitle={pageData.title}
            />
          </div>
        </div>
      </PublicSiteLayout>
    )
  } catch (error) {
    console.error('Error fetching page:', error)
    notFound()
  }
}
