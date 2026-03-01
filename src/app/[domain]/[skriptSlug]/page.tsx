import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { headers } from 'next/headers'
import { getFullSiteStructure } from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'

// Force dynamic rendering - this page uses headers() for hostname detection
export const dynamic = 'force-dynamic'
export const dynamicParams = true

interface SkriptPreviewProps {
  params: Promise<{
    domain: string
    skriptSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: SkriptPreviewProps): Promise<Metadata> {
  const { domain, skriptSlug } = await params

  try {
    const teacher = await prisma.user.findUnique({
      where: { pageSlug: domain },
      select: { id: true, name: true, title: true, pageIcon: true }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher profile could not be found.'
      }
    }

    // Skript slugs are globally unique
    const skript = await prisma.skript.findUnique({
      where: { slug: skriptSlug },
      select: { title: true }
    })

    if (!skript) {
      return {
        title: 'Skript Not Found',
        description: 'The requested skript could not be found.'
      }
    }

    return {
      title: `${skript.title} | ${teacher.name || domain}`,
      description: `${skript.title} by ${teacher.name || domain}`,
      ...(teacher.pageIcon ? { icons: { icon: teacher.pageIcon } } : {}),
      robots: 'noindex, nofollow'
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
  const { domain, skriptSlug } = await params

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
      where: { pageSlug: domain },
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        bio: true,
        pageSlug: true,
        pageName: true,
        pageDescription: true,
        pageIcon: true
      }
    })

    if (!teacher) {
      notFound()
    }

    // Check if current user is the author
    const isAuthor = session?.user?.email === teacher.email

    // Find skript by unique slug, verify teacher authorship
    const skript = await prisma.skript.findUnique({
      where: { slug: skriptSlug },
      include: {
        authors: { where: { userId: teacher.id }, select: { userId: true } },
        collectionSkripts: {
          include: {
            collection: {
              include: {
                authors: { where: { userId: teacher.id }, select: { userId: true } }
              }
            }
          },
          orderBy: { order: 'asc' },
          take: 1,
        },
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
    })

    if (!skript) {
      notFound()
    }

    // Verify teacher is an author
    const isTeacherAuthor = skript.authors.length > 0 ||
      skript.collectionSkripts.some(cs => (cs.collection?.authors?.length ?? 0) > 0)
    if (!isTeacherAuthor) {
      notFound()
    }

    // Authorization check: Only the author can preview unpublished skripts
    if (!skript.isPublished && !isAuthor) {
      notFound()
    }

    // Check for frontpage
    const frontPage = await prisma.frontPage.findFirst({
      where: { skriptId: skript.id }
    })

    // Fetch public annotations and snaps for this skript front page
    const [publicAnnotations, publicSnaps] = frontPage ? await Promise.all([
      prisma.userData.findMany({
        where: {
          adapter: 'annotations',
          itemId: frontPage.id,
          targetType: 'page',
        },
        select: {
          data: true,
          userId: true,
          user: { select: { name: true } }
        }
      }),
      prisma.userData.findMany({
        where: {
          adapter: 'snaps',
          itemId: frontPage.id,
          targetType: 'page',
        },
        select: {
          data: true,
          userId: true,
          user: { select: { name: true } }
        }
      })
    ]) : [[], []]

    // Skript authors can create public annotations
    const isPageAuthor = isAuthor

    // Show frontpage if: has content, OR author viewing (even empty/unpublished)
    const showFrontpage = frontPage?.content || isAuthor

    // Get collection info for sidebar structure
    const collectionSkript = skript.collectionSkripts[0]
    const collection = collectionSkript?.collection

    if (showFrontpage) {
      // Get teacher's preferences first
      const teacherPrefs = await prisma.user.findUnique({
        where: { id: teacher.id },
        select: { sidebarBehavior: true, typographyPreference: true }
      })

      // Build contextual structure
      const contextualStructure = collection
        ? buildSiteStructure([{
            id: collection.id,
            title: collection.title,
            slug: collection.slug,
            accentColor: collection.accentColor,
            collectionSkripts: [{
              order: collectionSkript.order,
              skript: {
                ...skript,
                pages: skript.pages.filter((p: CollectionPage) => isAuthor || p.isPublished)
              }
            }]
          }], { onlyPublished: !isAuthor })
        : [{
            id: 'standalone',
            title: skript.title,
            slug: skript.slug,
            skripts: [{
              id: skript.id,
              title: skript.title,
              slug: skript.slug,
              order: 0,
              pages: skript.pages
                .filter((p: CollectionPage) => isAuthor || p.isPublished)
                .map(p => ({ id: p.id, title: p.title, slug: p.slug }))
            }]
          }]

      // Get full site structure if in "full" mode
      const fullSiteStructure = teacherPrefs?.sidebarBehavior === 'full'
        ? await getFullSiteStructure(teacher.id, domain)
        : undefined

      const teacherData = {
        name: teacher.name || 'Teacher',
        pageSlug: teacher.pageSlug || '',
        pageName: teacher.pageName || null,
        pageDescription: teacher.pageDescription || null,
        pageIcon: teacher.pageIcon || null,
        bio: teacher.bio || null,
        title: teacher.title || null
      }

      return (
        <PublicSiteLayout
          teacher={teacherData}
          siteStructure={contextualStructure}
          rootSkripts={[]}
          fullSiteStructure={fullSiteStructure}
          sidebarBehavior={teacherPrefs?.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
          typographyPreference={teacherPrefs?.typographyPreference as 'modern' | 'classic' || 'modern'}
        >
          <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
            {/* Frontpage content or empty state for authors */}
            {frontPage?.content ? (
              <article className="prose-theme">
                <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} isPageAuthor={isPageAuthor}>
                  <ServerMarkdownRenderer
                    content={frontPage.content}
                    skriptId={skript.id}
                    pageId={frontPage.id}
                  />
                </AnnotationWrapper>
              </article>
            ) : isAuthor ? (
              <div className="text-center py-12">
                <h1 className="text-3xl font-bold mb-4">{skript.title}</h1>
                <p className="text-muted-foreground mb-6">
                  This skript doesn&apos;t have a frontpage yet.
                </p>
                <Link
                  href={`/dashboard/skripts/${skriptSlug}/frontpage`}
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
      const redirectUrl = hasSubdomain
        ? `/${skriptSlug}/${firstPage.slug}`
        : `/${domain}/${skriptSlug}/${firstPage.slug}`
      return <SkriptRedirect redirectUrl={redirectUrl} />
    }

    // If no pages are available, redirect to teacher homepage
    const redirectUrl = hasSubdomain
      ? `/`
      : `/${domain}`
    return <SkriptRedirect redirectUrl={redirectUrl} />

  } catch (error) {
    // Re-throw Next.js navigation errors (notFound, redirect) - these are expected
    if (error && typeof error === 'object' && 'digest' in error) {
      throw error
    }
    console.error('Error loading skript preview:', error)
    notFound()
  }
}
