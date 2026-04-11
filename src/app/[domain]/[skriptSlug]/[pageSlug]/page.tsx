import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ExamLockedPage } from '@/components/exam/exam-locked-page'
import { SEBRequiredPage } from '@/components/exam/seb-required-page'
import { ExamSubmittedPage } from '@/components/exam/exam-submitted-page'
import { TeacherExamToolbar } from '@/components/exam/teacher-exam-toolbar'
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
import { ForkAttribution } from '@/components/public/fork-attribution'

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
  // If the author visits a public URL for unpublished content, redirect to the preview URL
  // so they see the "not published" warning instead of a 404
  if (!content) {
    const session = await getServerSession(authOptions)
    if (session?.user?.id === teacher.id) {
      const unpublishedPage = await prisma.page.findFirst({
        where: {
          slug: pageSlug,
          skript: {
            slug: skriptSlug,
            OR: [
              { authors: { some: { userId: teacher.id } } },
              { collectionSkripts: { some: { collection: { authors: { some: { userId: teacher.id } } } } } }
            ]
          }
        },
        select: { id: true }
      })
      if (unpublishedPage) {
        redirect(`/preview/${domain}/${skriptSlug}/${pageSlug}`)
      }
    }
  }

  // TODO: Remove in spring 2026. Temporary legacy redirect for old URLs
  // that included the collection slug: /{domain}/{collectionSlug}/{skriptSlug} → /{domain}/{skriptSlug}
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
  let isTeacherViewingExam = false
  let unlockedClassesForExam: { id: string; name: string }[] = []
  let examState: 'closed' | 'lobby' | 'open' | null = null

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
        // Immediately create exam session so auth persists across refreshes.
        // Redirect to start-session API (Server Components can't set cookies),
        // which sets the cookie and redirects back here without seb_token.
        const currentUrl = `/${domain}/${skriptSlug}/${pageSlug}`
        const startSessionUrl = `/api/exams/${page.id}/start-session?` +
          `userId=${encodeURIComponent(authenticatedUserId)}&` +
          `skriptId=${encodeURIComponent(skript.id)}&` +
          `returnUrl=${encodeURIComponent(currentUrl)}`
        redirect(startSessionUrl)
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

    // Check 2: User must have an unlock (either via class membership, direct student unlock, or unlockForAll)
    const studentId = authenticatedUserId

    // Skip unlock check if exam is unlocked for all
    const hasUnlockForAll = examSettings?.unlockForAll === true

    // Check for direct student unlock
    const studentUnlock = !hasUnlockForAll ? await prisma.pageUnlock.findFirst({
      where: {
        pageId: page.id,
        studentId
      }
    }) : null

    // Check for class-based unlock (student is in a class that has this page unlocked)
    const classUnlock = !hasUnlockForAll ? await prisma.pageUnlock.findFirst({
      where: {
        pageId: page.id,
        classId: { not: null },
        class: {
          memberships: {
            some: { studentId }
          }
        }
      }
    }) : null

    const hasUnlock = hasUnlockForAll || studentUnlock || classUnlock

    // Check if user is a teacher/author
    const skriptAuthorRecord = await prisma.skriptAuthor.findFirst({
      where: { skriptId: skript.id, userId: studentId, permission: 'author' }
    })
    const collectionAuthorRecord = collection ? await prisma.collectionAuthor.findFirst({
      where: { collectionId: collection.id, userId: studentId, permission: 'author' }
    }) : null
    const isTeacherAuthor = !!(skriptAuthorRecord || collectionAuthorRecord)

    if (!hasUnlock && !isTeacherAuthor) {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.pageSlug || 'Unknown'}
          isLoggedIn={true}
          loginUrl={loginUrl}
        />
      )
    }

    // Set up teacher exam toolbar data
    if (isTeacherAuthor) {
      isTeacherViewingExam = true
      const unlocks = await prisma.pageUnlock.findMany({
        where: { pageId: page.id, classId: { not: null } },
        include: { class: { select: { id: true, name: true, teacherId: true } } }
      })
      unlockedClassesForExam = unlocks
        .filter(u => u.class?.teacherId === studentId)
        .map(u => ({ id: u.class!.id, name: u.class!.name }))
    }

    // Look up exam state for student's class
    if (!isTeacherAuthor && classUnlock?.classId) {
      const stateRecord = await prisma.examState.findUnique({
        where: { pageId_classId: { pageId: page.id, classId: classUnlock.classId } },
        select: { state: true }
      })
      examState = (stateRecord?.state as 'closed' | 'lobby' | 'open') || 'closed'
    }

    // Check 3: If student already submitted, show the submitted page
    if (!isTeacherAuthor) {
      const existingSubmission = await prisma.examSubmission.findUnique({
        where: {
          pageId_studentId: { pageId: page.id, studentId }
        },
        select: { submittedAt: true }
      })

      if (existingSubmission) {
        return (
          <ExamSubmittedPage
            pageTitle={page.title}
            pageId={page.id}
            submittedAt={existingSubmission.submittedAt}
          />
        )
      }
    }

    // Check 4: If SEB is required, verify request is from SEB
    // (Skip if authenticated via token or exam session - they must be in SEB)
    if (examSettings?.requireSEB && !isTeacherAuthor && !authenticatedViaToken && !authenticatedViaExamSession) {
      if (!isSEBRequest(headersList)) {
        return (
          <SEBRequiredPage
            pageTitle={page.title}
            pageId={page.id}
          />
        )
      }
    }

    // Check 5: If exam state is closed, block students
    if (!isTeacherAuthor && examState === 'closed') {
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
      }], { onlyPublished: !isPageAuthor })
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
      hideSidebar={page.pageType === 'exam'}
    >
      {isTeacherViewingExam && (
        <TeacherExamToolbar
          pageId={page.id}
          unlockedClasses={unlockedClassesForExam}
        />
      )}

      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border relative">
        {(page.forkedFromPageId || page.forkedFromAuthorId) && (
          <div className="absolute top-16 right-16">
            <ForkAttribution
              forkedFromPageId={page.forkedFromPageId}
              forkedFromAuthorId={page.forkedFromAuthorId}
            />
          </div>
        )}
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
