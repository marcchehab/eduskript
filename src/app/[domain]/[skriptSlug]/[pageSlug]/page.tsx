import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import {
  getTeacherByUsernameDeduped,
  getPublishedPage,
} from '@/lib/cached-queries'
import { PublicPageBody } from '@/components/public/public-page-body'
import type { Metadata } from 'next'
import { canonicalUrl, canonicalBase } from '@/lib/seo/canonical'
import { generateExcerpt } from '@/lib/markdown'
import { JsonLd, learningResourceSchema, breadcrumbSchema } from '@/lib/seo/json-ld'

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

    // Browser-tab title keeps the teacher suffix for branding; og:title is the
    // page title alone — social cards show siteName above the title already, so
    // duplicating it ("Binärsystem | Marc Chéhab" + "INFORMATIKGARTEN.CH") is
    // redundant.
    const browserTitle = `${content.page.title} | ${teacher.name || 'Eduskript'}`
    const ogTitle = content.page.title
    // og:description fallback chain. Teacher-authored description wins —
    // it's the only source that captures intent. Auto-derived excerpt is
    // next so every page still ships something. Collection description is
    // the per-skript fallback (every page in a collection would otherwise
    // share it). The template line is the last-resort safety net.
    const description =
      content.page.description ||
      generateExcerpt(content.page.content, 160) ||
      content.collection?.description ||
      `${content.page.title} by ${teacher.name}`
    const canonical = canonicalUrl({
      type: 'teacher',
      slug: teacher.pageSlug ?? domain,
      customDomains: teacher.customDomains,
      path: `/${skriptSlug}/${pageSlug}`,
    })

    // og:image: build the URL from the canonical path so multi-tenant custom
    // domains don't ship the proxy-prepended `/<pageSlug>/` prefix that
    // Next.js's auto-detected file-OG URL would include (and which 404s for
    // external crawlers). The colocated opengraph-image.tsx still generates
    // the PNG — we just point at it via the public-facing URL.
    const ogImage = `${canonical}/opengraph-image`
    return {
      metadataBase: canonicalBase({
        type: 'teacher',
        slug: teacher.pageSlug ?? domain,
        customDomains: teacher.customDomains,
      }),
      title: browserTitle,
      description,
      authors: [{ name: teacher.name || 'Unknown' }],
      alternates: { canonical },
      ...(teacher.pageIcon ? { icons: { icon: teacher.pageIcon } } : {}),
      openGraph: {
        title: ogTitle,
        description,
        type: 'article',
        siteName: teacher.name || 'Eduskript',
        url: canonical,
        images: [ogImage],
        publishedTime: content.page.createdAt.toISOString(),
        modifiedTime: content.page.updatedAt.toISOString(),
      },
      twitter: {
        card: 'summary_large_image',
        title: ogTitle,
        description,
        images: [ogImage],
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
  // Free teachers can't write to UserData (sync endpoint returns 402), so the
  // tables are empty by definition — skip the queries to keep anonymous visits
  // free of per-page DB roundtrips.
  const isFreeTeacher = teacher.billingPlan === 'free'
  const [publicAnnotations, publicSnaps] = isFreeTeacher
    ? [[], []]
    : await Promise.all([
        prisma.userData.findMany({
          where: { adapter: 'annotations', itemId: page.id, targetType: 'page' },
          select: { data: true, userId: true, user: { select: { name: true } } }
        }),
        prisma.userData.findMany({
          where: { adapter: 'snaps', itemId: page.id, targetType: 'page' },
          select: { data: true, userId: true, user: { select: { name: true } } }
        })
      ])

  const canonical = canonicalUrl({
    type: 'teacher',
    slug: teacher.pageSlug ?? domain,
    customDomains: teacher.customDomains,
    path: `/${skriptSlug}/${pageSlug}`,
  })
  const teacherHome = canonicalUrl({
    type: 'teacher',
    slug: teacher.pageSlug ?? domain,
    customDomains: teacher.customDomains,
  })
  const description =
    generateExcerpt(page.content, 160) ||
    content.collection?.description ||
    `${page.title} by ${teacher.name}`
  const ldSchemas = [
    learningResourceSchema({
      title: page.title,
      description,
      url: canonical,
      inLanguage: teacher.pageLanguage || 'en',
      author: teacher.name || teacher.pageName || 'Eduskript',
      dateCreated: page.createdAt,
      dateModified: page.updatedAt,
    }),
    breadcrumbSchema([
      { name: teacher.pageName || teacher.name || 'Home', url: teacherHome },
      { name: skript.title, url: `${teacherHome}/${skriptSlug}` },
      { name: page.title, url: canonical },
    ]),
  ]

  // Sidebar/layout chrome is provided by src/app/[domain]/[skriptSlug]/layout.tsx
  // (inherited at this segment). This page only renders the content body.
  return (
    <>
      <JsonLd schema={ldSchemas} />
      <PublicPageBody
        page={page}
        skriptId={skript.id}
        publicAnnotations={publicAnnotations}
        publicSnaps={publicSnaps}
      />
    </>
  )
}
