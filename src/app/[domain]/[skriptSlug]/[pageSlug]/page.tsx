import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import {
  getTeacherByUsernameDeduped,
  getPublishedPage,
} from '@/lib/cached-queries'
import { PublicPageBody } from '@/components/public/public-page-body'
import type { Metadata } from 'next'

interface PageProps {
  params: Promise<{
    domain: string
    skriptSlug: string
    pageSlug: string
  }>
}

// ISR: cached until explicitly invalidated via revalidateTag. Exam pages
// redirect to /exam/[domain]/[skriptSlug]/[pageSlug] (force-dynamic). The
// `isPageAuthor` flag for annotation UI is computed client-side in
// annotation-layer.tsx (ISR pages can't read the session server-side).
//
// Next.js 16 requires generateStaticParams() — even returning [] — for
// dynamic routes to use ISR instead of being fully dynamic.
export const revalidate = false
export const dynamicParams = true
export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, skriptSlug, pageSlug } = await params

  try {
    const teacher = await getTeacherByUsernameDeduped(domain)
    if (!teacher) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    const content = await getPublishedPage(
      teacher.id,
      skriptSlug,
      pageSlug,
      domain
    )

    if (!content) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.',
        robots: 'noindex'
      }
    }

    const title = `${content.page.title} | ${teacher.name || 'Eduskript'}`
    const description = content.collection?.description || `${content.page.title} by ${teacher.name}`

    return {
      title,
      description,
      authors: [{ name: teacher.name || 'Unknown' }],
      ...(teacher.pageIcon ? { icons: { icon: teacher.pageIcon } } : {}),
      openGraph: {
        title,
        description,
        type: 'article',
        siteName: teacher.name || 'Eduskript',
        url: `https://${domain}/${skriptSlug}/${pageSlug}`
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
  const { domain, skriptSlug, pageSlug } = await params

  // Filter out obviously invalid domain values (browser/system requests)
  const invalidDomains = ['.well-known', '_next', 'api', 'favicon', 'robots', 'sitemap', 'apple-touch-icon', 'manifest']
  if (invalidDomains.some(invalid => domain.startsWith(invalid) || domain.includes('.'))) {
    notFound()
  }

  const teacher = await getTeacherByUsernameDeduped(domain)
  if (!teacher) notFound()

  const content = await getPublishedPage(teacher.id, skriptSlug, pageSlug, domain)
  if (!content) notFound()

  const { skript, page } = content

  // Exam pages go through /exam/[domain]/... where headers()/cookies() and
  // exam-token validation live. The redirect itself is part of the ISR output,
  // so repeat hits to this URL return the cached 307 with zero dynamic cost.
  if (page.pageType === 'exam') {
    redirect(`/exam/${domain}/${skriptSlug}/${pageSlug}`)
  }

  // Public annotations/snaps are broadcast to every visitor — same data for
  // everyone, so safe to fetch inside the ISR cache. Invalidated via
  // revalidateTag when content changes.
  const [publicAnnotations, publicSnaps] = await Promise.all([
    prisma.userData.findMany({
      where: { adapter: 'annotations', itemId: page.id, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } }
    }),
    prisma.userData.findMany({
      where: { adapter: 'snaps', itemId: page.id, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } }
    })
  ])

  // Sidebar/layout chrome is provided by src/app/[domain]/[skriptSlug]/layout.tsx
  // (inherited at this segment). This page only renders the content body.
  return (
    <PublicPageBody
      page={page}
      skriptId={skript.id}
      publicAnnotations={publicAnnotations}
      publicSnaps={publicSnaps}
    />
  )
}
