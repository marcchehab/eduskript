import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ExamLockedPage } from '@/components/exam/exam-locked-page'
import { SEBRequiredPage } from '@/components/exam/seb-required-page'
import { ExamSubmittedPage } from '@/components/exam/exam-submitted-page'
import { isSEBRequest, type ExamSettings } from '@/lib/seb'
import { validateExamToken, validateExamSession } from '@/lib/exam-tokens'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import {
  getTeacherByUsernameDeduped,
  getPublishedPage,
  getFullSiteStructure,
} from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

interface PageProps {
  params: Promise<{
    domain: string
    skriptSlug: string
    pageSlug: string
  }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

// Force dynamic rendering - this page uses headers() and cookies() for exam features
export const dynamic = 'force-dynamic'
export const dynamicParams = true // Allow new params to be generated on-demand

// Empty generateStaticParams signals Next.js this route uses ISR
// Pages are generated on first request and then cached
export async function generateStaticParams() {
  return []
}

// Generate metadata for SEO (uses cached queries)
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

export default async function PublicPage({ params, searchParams }: PageProps) {
  const { domain, skriptSlug, pageSlug } = await params
  const resolvedSearchParams = await searchParams

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
    skriptSlug,
    pageSlug,
    domain
  )

  // Not found - try treating skriptSlug as a legacy collection slug to ignore.
  // Old URLs: /{domain}/{collectionSlug}/{skriptSlug} → redirect to /{domain}/{skriptSlug}
  if (!content) {
    const fallbackSkript = await prisma.skript.findFirst({
      where: {
        slug: pageSlug,
        isPublished: true,
        authors: { some: { user: { pageSlug: domain } } }
      },
      select: { id: true }
    })
    if (fallbackSkript) {
      // On custom domains the proxy already prepends the pageSlug,
      // so redirect without it to avoid a double prefix.
      const headersList = await headers()
      const hostname = (headersList.get('host') || '').split(':')[0]
      const isCustomDomain = !hostname.endsWith('.eduskript.org') && hostname !== 'localhost'
      redirect(isCustomDomain ? `/${pageSlug}` : `/${domain}/${pageSlug}`)
    }

    notFound()
  }

  const { collection, skript, page, allPages } = content

  // EXAM ACCESS CONTROL
  // Variable to track if we need to set an exam session cookie after rendering
  let examSessionToCreate: { userId: string; pageId: string; skriptId: string } | null = null

  // If this is an exam page, check if the user has access
  if (page.pageType === 'exam') {
    const headersList = await headers()
    const cookieStore = await cookies()
    const examSettings = page.examSettings as ExamSettings | null
    const currentUrl = `/${domain}/${skriptSlug}/${pageSlug}`
    const loginUrl = `/auth/signin?callbackUrl=${encodeURIComponent(currentUrl)}`

    // Authentication priority:
    // 1. SEB token (one-time, from config download)
    // 2. Exam session cookie (persistent during exam)
    // 3. Regular NextAuth session

    let authenticatedUserId: string | null = null
    let authenticatedViaToken = false
    let authenticatedViaExamSession = false

    // Check for SEB token authentication (one-time token from SEB config download)
    // Token only works if request is from SEB
    const sebToken = typeof resolvedSearchParams.seb_token === 'string'
      ? resolvedSearchParams.seb_token
      : undefined

    if (sebToken && isSEBRequest(headersList)) {
      authenticatedUserId = await validateExamToken(sebToken, page.id)
      if (authenticatedUserId) {
        authenticatedViaToken = true
        // We'll create an exam session after access control passes
      }
    }

    // Check for existing exam session (for multi-page navigation within SEB)
    if (!authenticatedUserId && isSEBRequest(headersList)) {
      const examSessionCookie = cookieStore.get('exam_session')?.value
      if (examSessionCookie) {
        authenticatedUserId = await validateExamSession(examSessionCookie, skript.id)
        if (authenticatedUserId) {
          authenticatedViaExamSession = true
        }
      }
    }

    // Fall back to regular NextAuth session
    if (!authenticatedUserId) {
      const session = await getServerSession(authOptions)
      authenticatedUserId = session?.user?.id || null
    }

    // Check 1: User must be logged in (or have valid SEB token)
    if (!authenticatedUserId) {
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
    const studentId = authenticatedUserId

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
      }) || (collection && await prisma.collectionAuthor.findFirst({
        where: { collectionId: collection.id, userId: studentId, permission: 'author' }
      }))

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

    // Check 3: If student already submitted, show the submitted page
    // This check comes before SEB check so students can see their status without SEB
    const existingSubmission = await prisma.examSubmission.findUnique({
      where: {
        pageId_studentId: { pageId: page.id, studentId }
      },
      select: { submittedAt: true }
    })

    // Only show submitted page for students, not teachers
    const isTeacherAuthor = await prisma.pageAuthor.findFirst({
      where: { pageId: page.id, userId: studentId, permission: 'author' }
    }) || await prisma.skriptAuthor.findFirst({
      where: { skriptId: skript.id, userId: studentId, permission: 'author' }
    }) || (collection && await prisma.collectionAuthor.findFirst({
      where: { collectionId: collection.id, userId: studentId, permission: 'author' }
    }))

    if (!isTeacherAuthor && existingSubmission) {
      return (
        <ExamSubmittedPage
          pageTitle={page.title}
          pageId={page.id}
          submittedAt={existingSubmission.submittedAt}
        />
      )
    }

    // Check 4: If SEB is required, verify request is from SEB
    // (Skip if authenticated via token or exam session - they must be in SEB)
    if (examSettings?.requireSEB && !authenticatedViaToken && !authenticatedViaExamSession) {
      if (!isSEBRequest(headersList)) {
        return (
          <SEBRequiredPage
            pageTitle={page.title}
            pageId={page.id}
          />
        )
      }
    }

    // Create exam session if authenticated via one-time token
    // This allows subsequent page navigations without re-authentication
    if (authenticatedViaToken) {
      examSessionToCreate = { userId: studentId, pageId: page.id, skriptId: skript.id }
    }
  }

  // Create exam session if needed (after all access control has passed)
  // We redirect to an API route because Server Components cannot set cookies during render
  if (examSessionToCreate) {
    const currentUrl = `/${domain}/${skriptSlug}/${pageSlug}`
    const startSessionUrl = `/api/exams/${examSessionToCreate.pageId}/start-session?` +
      `userId=${encodeURIComponent(examSessionToCreate.userId)}&` +
      `skriptId=${encodeURIComponent(examSessionToCreate.skriptId)}&` +
      `returnUrl=${encodeURIComponent(currentUrl)}`
    redirect(startSessionUrl)
  }

  // Fetch public annotations and snaps for this page (broadcast to all visitors)
  const [publicAnnotations, publicSnaps] = await Promise.all([
    prisma.userData.findMany({
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
    }),
    prisma.userData.findMany({
      where: {
        adapter: 'snaps',
        itemId: page.id,
        targetType: 'page',
      },
      select: {
        data: true,
        userId: true,
        user: { select: { name: true } }
      }
    })
  ])

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
      } else if (collection) {
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

  // Build site structure for contextual navigation
  const siteStructure = collection
    ? buildSiteStructure([{
        id: collection.id,
        title: collection.title,
        slug: collection.slug,
        accentColor: collection.accentColor,
        isPublished: collection.isPublished,
        collectionSkripts: [{
          order: skript.order,
          skript: {
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            isPublished: skript.isPublished,
            pages: allPages
          }
        }]
      }], { onlyPublished: true })
    : [{
        id: 'standalone',
        title: skript.title,
        slug: skript.slug,
        skripts: [{
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          order: 0,
          pages: allPages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
        }]
      }]

  // Fetch full site structure if sidebar behavior is "full" (cached)
  const fullSiteStructure = teacher.sidebarBehavior === 'full'
    ? await getFullSiteStructure(teacher.id, domain)
    : undefined

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

  const currentPath = `/${skriptSlug}/${pageSlug}`

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
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        <article className="prose-theme">
          <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} isPageAuthor={isPageAuthor}>
            <ServerMarkdownRenderer
              content={page.content}
              skriptId={skript.id}
              pageId={page.id}
            />
          </AnnotationWrapper>
        </article>

      </div>

    </PublicSiteLayout>
  )
}
