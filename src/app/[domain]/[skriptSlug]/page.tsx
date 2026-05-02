import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { headers } from 'next/headers'

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

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        OR: [
          { authors: { some: { userId: teacher.id } } },
          { collectionSkripts: { some: { collection: { authors: { some: { userId: teacher.id } } } } } }
        ]
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

export default async function SkriptPreviewPage({ params }: SkriptPreviewProps) {
  const { domain, skriptSlug } = await params

  // Filter out obviously invalid domain values (browser/system requests)
  const invalidDomains = ['.well-known', '_next', 'api', 'favicon', 'robots', 'sitemap', 'apple-touch-icon', 'manifest']
  if (invalidDomains.some(invalid => domain.startsWith(invalid) || domain.includes('.'))) {
    notFound()
  }

  const session = await getServerSession(authOptions)

  // Check request headers for proxy-stripped URLs on custom domains
  const headersList = await headers()
  const hostname = headersList.get('host') || ''
  const hostWithoutPort = hostname.split(':')[0]
  const parts = hostWithoutPort.split('.')
  const hasSubdomain = (parts.length > 1 && parts[parts.length - 1] === 'localhost') ||
                      (parts.length > 2 && parts[parts.length - 2] === 'eduskript')

  try {
    // Note: the parent layout at [domain]/[skriptSlug]/layout.tsx already
    // verifies teacher + skript existence and author-gates unpublished skripts.
    // Queries here are the frontpage-specific parts only; Prisma request-scoped
    // dedup keeps the cost low when fields overlap with the layout's fetch.

    const teacher = await prisma.user.findUnique({
      where: { pageSlug: domain },
      select: { id: true, email: true, billingPlan: true }
    })

    if (!teacher) {
      notFound()
    }

    const isAuthor = session?.user?.email === teacher.email
    const isFreeTeacher = teacher.billingPlan === 'free'

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        OR: [
          { authors: { some: { userId: teacher.id } } },
          { collectionSkripts: { some: { collection: { authors: { some: { userId: teacher.id } } } } } }
        ]
      },
      select: {
        id: true,
        title: true,
        slug: true,
        isPublished: true,
        pages: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            slug: true,
            isPublished: true,
          }
        }
      }
    })

    if (!skript) {
      notFound()
    }

    // Only published skripts are served from /[domain]/. An author visiting
    // their own unpublished skript still sees its frontpage here, but the
    // shared sidebar (fed from published-only fullSiteStructure in
    // [domain]/layout.tsx) won't list it — acceptable trade-off for keeping
    // /[domain]/ URLs uniformly "public-mode".
    if (!skript.isPublished && !isAuthor) {
      notFound()
    }

    const frontPage = await prisma.frontPage.findFirst({
      where: { skriptId: skript.id }
    })

    // Free teachers can't write to UserData (sync endpoint returns 402), so
    // these tables are empty by definition — skip the queries.
    const [publicAnnotations, publicSnaps] = frontPage && !isFreeTeacher ? await Promise.all([
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

    const isPageAuthor = isAuthor
    const showFrontpage = frontPage?.content || isAuthor

    if (showFrontpage) {
      return (
        <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
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
      )
    }

    // No frontpage - redirect to first available page
    const firstPage = skript.pages.find(page => isAuthor || page.isPublished)

    if (firstPage) {
      const redirectUrl = hasSubdomain
        ? `/${skriptSlug}/${firstPage.slug}`
        : `/${domain}/${skriptSlug}/${firstPage.slug}`
      return <SkriptRedirect redirectUrl={redirectUrl} />
    }

    // If no pages are available, redirect to teacher homepage
    const redirectUrl = hasSubdomain ? `/` : `/${domain}`
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
