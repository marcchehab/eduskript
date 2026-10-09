import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { ReflowGate } from '@/components/public/reflow-gate'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import { getPublicLayers, EMPTY_PUBLIC_LAYERS } from '@/lib/public-page-data'
import { placedOnSiteWhere } from '@/lib/site-access'

// Force dynamic rendering — the page is session-dependent (author gating).
// ISR: the route renders published content only and reads no session, so every
// visitor gets the same HTML and it can be cached until invalidated. Next.js 16
// needs generateStaticParams() — even empty — or a dynamic route stays dynamic.
export const revalidate = false
export const dynamicParams = true
export async function generateStaticParams() {
  return []
}

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
    const teacherSite = await prisma.site.findUnique({
      where: { slug: domain },
      select: {
        id: true,
        pageIcon: true,
        user: { select: { id: true, name: true, title: true } },
      },
    })
    const teacher = teacherSite?.user
      ? { ...teacherSite.user, pageIcon: teacherSite.pageIcon }
      : null

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher profile could not be found.'
      }
    }

    // Site scoping: only skripts placed on THIS site (src/lib/site-access.ts).
    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        isPublished: true,
        ...(await placedOnSiteWhere(teacherSite!.id)),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

  try {
    // Note: the parent layout at [domain]/[skriptSlug]/layout.tsx already
    // verifies teacher + skript existence and author-gates unpublished skripts.
    // Queries here are the frontpage-specific parts only; Prisma request-scoped
    // dedup keeps the cost low when fields overlap with the layout's fetch.

    const teacherSiteRow = await prisma.site.findUnique({
      where: { slug: domain },
      select: { id: true, pageLanguage: true, user: { select: { id: true, email: true, billingPlan: true } } }
    })
    const teacher = teacherSiteRow?.user

    if (!teacher) {
      notFound()
    }

    // Site scoping: a skript renders only on sites that place it.
    const siteId = teacherSiteRow!.id
    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        isPublished: true, // same resolution as getPublishedPage (bughunt #38)
        ...(await placedOnSiteWhere(siteId)),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

    // Only published skripts are served from /[domain]/. This used to make an
    // exception for the author, which required reading the session and so made
    // the route dynamic for everyone — crawlers included. Published-only keeps
    // the response identical for every visitor (a prerequisite for a shared
    // cache) and matches the sidebar, which is fed from the published-only
    // fullSiteStructure in [domain]/layout.tsx. Authors preview unpublished
    // work from the dashboard.
    if (!skript.isPublished) {
      notFound()
    }

    const frontPage = await prisma.frontPage.findFirst({
      where: { skriptId: skript.id }
    })

    // Always run the lookup when there's a frontpage. The previous
    // `isFreeTeacher` gate read from `getTeacherByPageSlug`'s unstable_cache,
    // which is never invalidated on billing_plan changes — so a free→pro
    // upgrade left public layers permanently empty.
    const { publicAnnotations, publicSnaps, publicStickyNotes } = frontPage
      ? await getPublicLayers(frontPage.id, siteId)
      : EMPTY_PUBLIC_LAYERS

    // Authorship for the annotation toolbar is resolved client-side inside
    // AnnotationLayer, so nothing per-visitor reaches the cached HTML.
    if (frontPage?.content) {
      return (
        <>
        {/* Class toolbar (portals into the sidebar slot). Self-gates on
            own-site + paid + has-classes; needs the frontPage id as pageId. */}
        {frontPage?.id && (
          <ClassToolbar
            pageId={frontPage.id}
            pageType="standard"
            unlockedClasses={[]}
            siteId={siteId}
          />
        )}
        <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
          <article className="prose-theme">
            <ReflowGate pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} publicStickyNotes={publicStickyNotes}>
              <ServerMarkdownRenderer
                content={frontPage.content}
                skriptId={skript.id}
                pageId={frontPage.id}
                ownerPageSlug={domain}
                pageLanguage={teacherSiteRow?.pageLanguage}
              />
            </ReflowGate>
          </article>
        </div>
        </>
      )
    }

    // No frontpage - redirect to first published page
    const firstPage = skript.pages.find(page => page.isPublished)

    if (firstPage) {
      return <SkriptRedirect redirectUrl={`/${domain}/${skriptSlug}/${firstPage.slug}`} />
    }

    // If no pages are available, redirect to teacher homepage
    return <SkriptRedirect redirectUrl={`/${domain}`} />

  } catch (error) {
    // Re-throw Next.js navigation errors (notFound, redirect) - these are expected
    if (error && typeof error === 'object' && 'digest' in error) {
      throw error
    }
    console.error('Error loading skript preview:', error)
    notFound()
  }
}
