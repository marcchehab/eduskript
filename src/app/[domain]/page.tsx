import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getTeacherByUsernameDeduped } from '@/lib/cached-queries'
import { prisma } from '@/lib/prisma'
import { canonicalUrl, canonicalBase } from '@/lib/seo/canonical'

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

    // ISR-safe SEO metadata: derive everything from cached DB data, never
    // from request headers. Reading headers() here would opt this route
    // out of static generation.
    const primaryDomain = teacher.customDomains?.[0]?.domain
    const canonical = canonicalUrl({
      type: 'teacher',
      slug: teacher.pageSlug ?? domain,
      customDomains: teacher.customDomains,
    })

    const baseTitle = teacher.pageName || teacher.name || 'Eduskript'
    const title = primaryDomain && teacher.pageTagline
      ? `${baseTitle} — ${teacher.pageTagline}`
      : baseTitle
    const description = teacher.pageDescription || teacher.bio || `Educational content by ${teacher.pageName || teacher.name}`

    // og:image is provided by src/app/[domain]/opengraph-image.tsx — passing
    // images here would override the file-based OG, so we omit it. metadataBase
    // anchors the relative OG image URL to the tenant's public host so social
    // crawlers fetch from the right domain (custom domain when present).
    return {
      metadataBase: canonicalBase({
        type: 'teacher',
        slug: teacher.pageSlug ?? domain,
        customDomains: teacher.customDomains,
      }),
      title,
      description,
      authors: [{ name: teacher.name || 'Unknown' }],
      alternates: { canonical },
      ...(teacher.pageIcon ? { icons: { icon: teacher.pageIcon } } : {}),
      openGraph: {
        title,
        description,
        type: 'website',
        siteName: teacher.pageName || teacher.name || 'Eduskript',
        url: canonical,
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
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

  // The parent layout (src/app/[domain]/layout.tsx) already validates the
  // domain and renders the PublicSiteLayout shell. This page only produces
  // the homepage content that slots into children.

  const teacher = await getTeacherByUsernameDeduped(domain)
  if (!teacher) notFound()

  const session = await getServerSession(authOptions)
  const isOwner = session?.user?.id === teacher.id

  const frontPage = await prisma.frontPage.findFirst({
    where: { userId: teacher.id },
    select: {
      id: true,
      content: true,
      isPublished: true,
      fileSkriptId: true,
    }
  })

  // Free teachers can't write to UserData (sync endpoint returns 402), so the
  // public-annotation/snap tables are empty by definition — skip the queries.
  const isFreeTeacher = teacher.billingPlan === 'free'
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

  // Owner can create public annotations on their own front page
  const isPageAuthor = isOwner

  return (
    <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
      {frontPage?.content ? (
        <article className="prose-theme">
          <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} isPageAuthor={isPageAuthor}>
            <ServerMarkdownRenderer
              content={frontPage.content}
              pageId={frontPage.id}
              skriptId={frontPage.fileSkriptId || undefined}
            />
          </AnnotationWrapper>
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
  )
}
