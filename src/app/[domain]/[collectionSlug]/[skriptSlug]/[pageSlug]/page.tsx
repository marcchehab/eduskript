import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ExportPDF } from '@/components/public/export-pdf'
import { DevClearDataButton } from '@/components/dev/dev-clear-data-button'
import { ExamLockedPage } from '@/components/exam/exam-locked-page'
import { SEBRequiredPage } from '@/components/exam/seb-required-page'
import { isSEBRequest, type ExamSettings } from '@/lib/seb'
import type { Metadata } from 'next'
import {
  getTeacherByUsernameDeduped,
  getPublishedPage,
  getAllPublishedCollections,
} from '@/lib/cached-queries'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

interface PageProps {
  params: Promise<{
    domain: string
    collectionSlug: string
    skriptSlug: string
    pageSlug: string
  }>
}

// Enable ISR - pages are cached until explicitly invalidated via revalidateTag
export const revalidate = false // Cache indefinitely, invalidate on content update
export const dynamicParams = true // Allow new params to be generated on-demand

// Empty generateStaticParams signals Next.js this route uses ISR
// Pages are generated on first request and then cached
export async function generateStaticParams() {
  return []
}

// Generate metadata for SEO (uses cached queries)
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, collectionSlug, skriptSlug, pageSlug } = await params

  try {
    // Use cached teacher lookup
    const teacher = await getTeacherByUsernameDeduped(domain)
    if (!teacher) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Use cached content lookup (only returns published content)
    const content = await getPublishedPage(
      teacher.id,
      collectionSlug,
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
    const description = content.collection.description || `${content.page.title} by ${teacher.name}`

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

  // Filter out obviously invalid domain values (browser/system requests)
  const invalidDomains = ['.well-known', '_next', 'api', 'favicon', 'robots', 'sitemap', 'apple-touch-icon', 'manifest']
  if (invalidDomains.some(invalid => domain.startsWith(invalid) || domain.includes('.'))) {
    notFound()
  }

  // Get teacher from cache
  const teacher = await getTeacherByUsernameDeduped(domain)
  if (!teacher) {
    notFound()
  }

  // Get published content from cache
  const content = await getPublishedPage(
    teacher.id,
    collectionSlug,
    skriptSlug,
    pageSlug,
    domain
  )

  // Not found or not published - 404
  // (Authors can use /preview/[domain]/... to view unpublished content)
  if (!content) {
    notFound()
  }

  const { collection, skript, page, allPages } = content

  // EXAM ACCESS CONTROL
  // If this is an exam page, check if the user has access
  if (page.pageType === 'exam') {
    const session = await getServerSession(authOptions)
    const currentUrl = `/${domain}/${collectionSlug}/${skriptSlug}/${pageSlug}`
    const loginUrl = `/auth/signin?callbackUrl=${encodeURIComponent(currentUrl)}`

    // Check 1: User must be logged in
    if (!session?.user?.id) {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.pageSlug || 'Unknown'}
          isLoggedIn={false}
          loginUrl={loginUrl}
        />
      )
    }

    // Check 2: User must have an unlock (either via class membership or direct student unlock)
    const studentId = session.user.id

    // Check for direct student unlock
    const studentUnlock = await prisma.pageUnlock.findFirst({
      where: {
        pageId: page.id,
        studentId
      }
    })

    // Check for class-based unlock (student is in a class that has this page unlocked)
    const classUnlock = await prisma.pageUnlock.findFirst({
      where: {
        pageId: page.id,
        classId: { not: null },
        class: {
          memberships: {
            some: { studentId }
          }
        }
      }
    })

    const hasUnlock = studentUnlock || classUnlock

    if (!hasUnlock) {
      // Allow teachers (page authors) to access their own exam pages without unlock
      const isTeacherAuthor = await prisma.pageAuthor.findFirst({
        where: { pageId: page.id, userId: studentId, permission: 'author' }
      }) || await prisma.skriptAuthor.findFirst({
        where: { skriptId: skript.id, userId: studentId, permission: 'author' }
      }) || await prisma.collectionAuthor.findFirst({
        where: { collectionId: collection.id, userId: studentId, permission: 'author' }
      })

      if (!isTeacherAuthor) {
        return (
          <ExamLockedPage
            pageTitle={page.title}
            teacherName={teacher.name || teacher.pageSlug || 'Unknown'}
            isLoggedIn={true}
            loginUrl={loginUrl}
          />
        )
      }
    }

    // Check 3: If SEB is required, verify request is from SEB
    const examSettings = page.examSettings as ExamSettings | null
    if (examSettings?.requireSEB) {
      const headersList = await headers()
      if (!isSEBRequest(headersList)) {
        return (
          <SEBRequiredPage
            pageTitle={page.title}
            pageId={page.id}
          />
        )
      }
    }
  }

  // Fetch public annotations for this page (annotations broadcast to all visitors)
  const publicAnnotations = await prisma.userData.findMany({
    where: {
      adapter: 'annotations',
      itemId: page.id,
      targetType: 'page',
    },
    select: {
      data: true,
      userId: true,
      user: { select: { name: true } }
    }
  })

  // Check if current user can create public annotations
  // User must have author permission on page, skript, or collection
  let isPageAuthor = false
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    const userId = session.user.id

    // Check PageAuthor
    const pageAuthor = await prisma.pageAuthor.findFirst({
      where: { pageId: page.id, userId, permission: 'author' }
    })
    if (pageAuthor) {
      isPageAuthor = true
    } else {
      // Check SkriptAuthor
      const skriptAuthor = await prisma.skriptAuthor.findFirst({
        where: { skriptId: skript.id, userId, permission: 'author' }
      })
      if (skriptAuthor) {
        isPageAuthor = true
      } else {
        // Check CollectionAuthor
        const collectionAuthor = await prisma.collectionAuthor.findFirst({
          where: { collectionId: collection.id, userId, permission: 'author' }
        })
        if (collectionAuthor) {
          isPageAuthor = true
        }
      }
    }
  }

  // Build site structure for navigation (only published pages)
  const siteStructure = [{
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    skripts: [{
      id: skript.id,
      title: skript.title,
      slug: skript.slug,
      pages: allPages.map(p => ({
        id: p.id,
        title: p.title,
        slug: p.slug
      }))
    }]
  }]

  // Fetch full site structure if sidebar behavior is "full" (cached)
  let fullSiteStructure = undefined
  if (teacher.sidebarBehavior === 'full') {
    const allCollections = await getAllPublishedCollections(teacher.id, domain)

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
    name: teacher.name || teacher.pageSlug || 'Unknown',
    pageSlug: teacher.pageSlug || domain,
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${collectionSlug}/${skriptSlug}/${pageSlug}`

  return (
    <PublicSiteLayout
      teacher={teacherForLayout}
      siteStructure={siteStructure}
      currentPath={currentPath}
      fullSiteStructure={fullSiteStructure}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      pageId={page.id}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10" style={{ maxWidth: 'min(1280px, calc(100vw - 48px))', marginLeft: 'auto', marginRight: 'auto' }}>
        <article className="prose-theme">
          <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor}>
            <ServerMarkdownRenderer
              content={page.content}
              skriptId={skript.id}
              pageId={page.id}
            />
          </AnnotationWrapper>
        </article>

        <div className="mt-8 pt-8 border-t border-border">
          <ExportPDF
            content={page.content}
            title={page.title}
            author={teacherForLayout.name}
          />
        </div>
      </div>

      {/* Dev-only button to clear user data for this page */}
      <DevClearDataButton pageId={page.id} />
    </PublicSiteLayout>
  )
}
