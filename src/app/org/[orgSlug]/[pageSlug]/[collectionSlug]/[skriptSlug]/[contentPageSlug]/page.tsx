import { notFound, redirect } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ExportPDF } from '@/components/public/export-pdf'
import { DevClearDataButton } from '@/components/dev/dev-clear-data-button'
import { ExamSessionIndicator } from '@/components/exam/exam-session-indicator'
import { ExamLockedPage } from '@/components/exam/exam-locked-page'
import { SEBRequiredPage } from '@/components/exam/seb-required-page'
import { ExamSubmittedPage } from '@/components/exam/exam-submitted-page'
import { ExamLayout } from '@/components/exam/exam-layout'
import { ExamWaitingRoom } from '@/components/exam/exam-waiting-room'
import { TeacherExamToolbar } from '@/components/exam/teacher-exam-toolbar'
import { ExamDataSync } from '@/components/exam/exam-data-sync'
import { isSEBRequest, type ExamSettings } from '@/lib/seb'
import { validateExamToken, validateExamSession } from '@/lib/exam-tokens'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { headers } from 'next/headers'

interface PageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
    collectionSlug: string
    skriptSlug: string
    contentPageSlug: string
  }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

// Enable ISR
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, pageSlug, collectionSlug, skriptSlug, contentPageSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Find teacher who is a member of this org
    const teacher = await prisma.user.findFirst({
      where: {
        pageSlug: pageSlug,
        organizationMemberships: {
          some: { organizationId: organization.id }
        }
      },
      select: { id: true, name: true, pageName: true }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher could not be found.'
      }
    }

    // Get the page
    const page = await prisma.page.findFirst({
      where: {
        slug: contentPageSlug,
        skript: {
          slug: skriptSlug,
          collectionSkripts: {
            some: {
              collection: {
                slug: collectionSlug,
                authors: {
                  some: { userId: teacher.id }
                }
              }
            }
          }
        }
      },
      include: {
        skript: {
          include: {
            collectionSkripts: {
              include: { collection: true },
              take: 1
            }
          }
        }
      }
    })

    if (!page) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.',
        robots: 'noindex'
      }
    }

    const teacherName = teacher.pageName || teacher.name || 'Teacher'
    const title = `${page.title} | ${teacherName} | ${organization.name}`
    const description = `${page.title} by ${teacherName}`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'article',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}/${collectionSlug}/${skriptSlug}/${contentPageSlug}`
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

export default async function OrgTeacherContentPage({ params, searchParams }: PageProps) {
  const { orgSlug, pageSlug, collectionSlug, skriptSlug, contentPageSlug } = await params
  const resolvedSearchParams = await searchParams

  // Get organization
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      description: true,
      logoUrl: true
    }
  })

  if (!organization) {
    notFound()
  }

  // Find teacher who is a member of this org
  const teacher = await prisma.user.findFirst({
    where: {
      pageSlug: pageSlug,
      organizationMemberships: {
        some: { organizationId: organization.id }
      }
    },
    select: {
      id: true,
      name: true,
      pageName: true,
      pageDescription: true,
      pageIcon: true,
      bio: true,
      title: true,
      sidebarBehavior: true,
      typographyPreference: true
    }
  })

  if (!teacher) {
    notFound()
  }

  // Get the page with its skript and collection
  const page = await prisma.page.findFirst({
    where: {
      slug: contentPageSlug,
      skript: {
        slug: skriptSlug,
        collectionSkripts: {
          some: {
            collection: {
              slug: collectionSlug,
              authors: {
                some: { userId: teacher.id }
              }
            }
          }
        }
      }
    },
    include: {
      skript: {
        include: {
          collectionSkripts: {
            where: {
              collection: {
                slug: collectionSlug
              }
            },
            include: { collection: true },
            take: 1
          },
          pages: {
            where: { isPublished: true },
            orderBy: { order: 'asc' },
            select: { id: true, title: true, slug: true }
          }
        }
      }
    }
  })

  if (!page || !page.skript.collectionSkripts[0]?.collection) {
    notFound()
  }

  const skript = page.skript
  // collection is guaranteed to exist by the check above
  const collection = skript.collectionSkripts[0].collection!
  const allPages = skript.pages

  // EXAM ACCESS CONTROL
  // Variable to track if we need to set an exam session cookie after rendering
  let examSessionToCreate: { userId: string; pageId: string; skriptId: string } | null = null
  // Track if user is in an active SEB exam session (for UI indicator)
  let isInExamSession = false
  let examSessionUserName: string | null = null
  let examSessionUserEmail: string | null = null
  // Track exam state for waiting room
  let examState: 'closed' | 'lobby' | 'open' | null = null
  let examClassId: string | null = null
  // Track if current user is a teacher viewing their own exam
  let isTeacherViewingExam = false
  let unlockedClassesForExam: { id: string; name: string }[] = []
  // Track if student has already submitted (shown ExamSubmittedPage instead of SEBRequiredPage)
  let existingSubmission: { submittedAt: Date } | null = null
  // Track the authenticated user's ID for exam session (needed outside the access control block)
  let examAuthenticatedUserId: string | null = null

  if (page.pageType === 'exam') {
    const headersList = await headers()
    const cookieStore = await cookies()
    const examSettings = page.examSettings as ExamSettings | null
    const currentUrl = `/org/${orgSlug}/${pageSlug}/${collectionSlug}/${skriptSlug}/${contentPageSlug}`
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
          isInExamSession = true
          // Fetch user info for the exam header
          const examUser = await prisma.user.findUnique({
            where: { id: authenticatedUserId },
            select: { name: true, email: true }
          })
          examSessionUserName = examUser?.name || null
          examSessionUserEmail = examUser?.email || null
        }
      }
    }

    // Fall back to regular NextAuth session
    if (!authenticatedUserId) {
      const session = await getServerSession(authOptions)
      authenticatedUserId = session?.user?.id || null
    }

    // Check 1: User must be logged in
    if (!authenticatedUserId) {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.pageName || 'Unknown'}
          isLoggedIn={false}
          loginUrl={loginUrl}
        />
      )
    }

    const studentId = authenticatedUserId
    // Preserve authenticated user ID for use outside this block
    examAuthenticatedUserId = authenticatedUserId

    // Check for unlock
    const studentUnlock = await prisma.pageUnlock.findFirst({
      where: { pageId: page.id, studentId }
    })

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

    // Check if user is a teacher (page author) - they can always access
    const skriptAuthorRecord = await prisma.skriptAuthor.findFirst({
      where: { skriptId: skript.id, userId: studentId, permission: 'author' }
    })
    const collectionAuthorRecord = await prisma.collectionAuthor.findFirst({
      where: { collectionId: collection.id, userId: studentId, permission: 'author' }
    })
    const isTeacherAuthor = !!(skriptAuthorRecord || collectionAuthorRecord)

    if (!hasUnlock && !isTeacherAuthor) {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.pageName || 'Unknown'}
          isLoggedIn={true}
          loginUrl={loginUrl}
        />
      )
    }

    // If teacher is viewing, fetch unlocked classes for the toolbar
    if (isTeacherAuthor) {
      isTeacherViewingExam = true
      const unlocks = await prisma.pageUnlock.findMany({
        where: {
          pageId: page.id,
          classId: { not: null }
        },
        include: {
          class: {
            select: { id: true, name: true, teacherId: true }
          }
        }
      })
      // Only show classes where this user is the teacher
      unlockedClassesForExam = unlocks
        .filter(u => u.class?.teacherId === studentId)
        .map(u => ({ id: u.class!.id, name: u.class!.name }))
    }

    // For students, check the exam state
    if (!isTeacherAuthor && classUnlock?.classId) {
      examClassId = classUnlock.classId
      const stateRecord = await prisma.examState.findUnique({
        where: {
          pageId_classId: { pageId: page.id, classId: classUnlock.classId }
        },
        select: { state: true }
      })
      examState = (stateRecord?.state as 'closed' | 'lobby' | 'open') || 'closed'
    }

    // Check for existing submission (students who already submitted)
    if (!isTeacherAuthor) {
      const submission = await prisma.examSubmission.findUnique({
        where: {
          pageId_studentId: { pageId: page.id, studentId }
        },
        select: { submittedAt: true }
      })
      if (submission) {
        existingSubmission = { submittedAt: submission.submittedAt }
      }
    }

    // Check 3: If student already submitted, show the submitted page
    // This check comes before SEB check so students can see their status without SEB
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
    // (Skip if teacher, or if authenticated via token/exam session - they must be in SEB)
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

    // Check 4: If exam is closed, students cannot enter
    // (Lobby allows entry but shows waiting room, closed blocks completely)
    if (!isTeacherAuthor && examState === 'closed') {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.pageName || 'Unknown'}
          isLoggedIn={true}
          loginUrl={`/auth/signin?callbackUrl=${encodeURIComponent(`/org/${orgSlug}/${pageSlug}/${collectionSlug}/${skriptSlug}/${contentPageSlug}`)}`}
        />
      )
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
    const currentUrl = `/org/${orgSlug}/${pageSlug}/${collectionSlug}/${skriptSlug}/${contentPageSlug}`
    const startSessionUrl = `/api/exams/${examSessionToCreate.pageId}/start-session?` +
      `userId=${encodeURIComponent(examSessionToCreate.userId)}&` +
      `skriptId=${encodeURIComponent(examSessionToCreate.skriptId)}&` +
      `returnUrl=${encodeURIComponent(currentUrl)}`
    redirect(startSessionUrl)
  }

  // Fetch public annotations
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
  let isPageAuthor = false
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    const skriptAuthor = await prisma.skriptAuthor.findFirst({
      where: {
        skriptId: skript.id,
        userId: session.user.id,
        permission: 'author'
      }
    })
    isPageAuthor = !!skriptAuthor
  }

  // Build site structure for navigation
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

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacher.pageName || pageSlug,
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${collectionSlug}/${skriptSlug}/${contentPageSlug}`

  // Determine if user is a student in exam session (for client-side annotation layer)
  // In SEB mode, NextAuth session isn't available, so we pass this explicitly
  const isExamStudent = isInExamSession && !isTeacherViewingExam

  // Content block used by both layouts
  const examContent = (
    <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10">
      <article className="prose-theme">
        <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor} isExamStudent={isExamStudent}>
          <ServerMarkdownRenderer
            content={page.content}
            skriptId={skript.id}
            pageId={page.id}
            organizationSlug={orgSlug}
          />
        </AnnotationWrapper>
      </article>

      <div className="mt-8 pt-8 border-t border-border">
        <ExportPDF
          content={page.content}
          title={page.title}
          author={teacherData.name}
        />
      </div>
    </div>
  )

  // For students in SEB exam session, use the ExamLayout (no sidebar)
  // Wrap with ExamDataSync to enable data sync (NextAuth session isn't available in SEB)
  if (isInExamSession && !isTeacherViewingExam && examAuthenticatedUserId) {
    // Show waiting room if exam is in lobby state
    if (examState === 'lobby' && examClassId) {
      return (
        <ExamDataSync
          userId={examAuthenticatedUserId}
          userName={examSessionUserName}
          userEmail={examSessionUserEmail}
          pageId={page.id}
        >
          <ExamLayout
            pageId={page.id}
            pageTitle={page.title}
            studentName={examSessionUserName}
            studentEmail={examSessionUserEmail}
            typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
          >
            <ExamWaitingRoom
              pageId={page.id}
              classId={examClassId}
              examTitle={page.title}
            />
            <DevClearDataButton pageId={page.id} />
          </ExamLayout>
        </ExamDataSync>
      )
    }

    // Show exam content with ExamLayout
    return (
      <ExamDataSync
        userId={examAuthenticatedUserId}
        userName={examSessionUserName}
        userEmail={examSessionUserEmail}
        pageId={page.id}
      >
        <ExamLayout
          pageId={page.id}
          pageTitle={page.title}
          studentName={examSessionUserName}
          studentEmail={examSessionUserEmail}
          typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
        >
          {examContent}
          <DevClearDataButton pageId={page.id} />
        </ExamLayout>
      </ExamDataSync>
    )
  }

  // Regular layout (for teachers and non-exam pages)
  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={siteStructure}
      currentPath={currentPath}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
      pageId={page.id}
    >
      {/* Teacher exam toolbar - only shown when teacher is viewing their own exam */}
      {isTeacherViewingExam && (
        <TeacherExamToolbar
          pageId={page.id}
          unlockedClasses={unlockedClassesForExam}
        />
      )}

      {examContent}

      <DevClearDataButton pageId={page.id} />
      {isInExamSession && <ExamSessionIndicator userName={examSessionUserName} />}
    </PublicSiteLayout>
  )
}
