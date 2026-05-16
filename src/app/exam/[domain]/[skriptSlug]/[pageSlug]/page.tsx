import { notFound, redirect } from 'next/navigation'
import { headers, cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getTeacherByUsernameDeduped,
  getTeacherWithLayout,
  getFullSiteStructure,
  getPublishedPage,
} from '@/lib/cached-queries'
import { PublicSiteLayout } from '@/components/public/layout'
import { PublicPageBody } from '@/components/public/public-page-body'
import { ExamLockedPage } from '@/components/exam/exam-locked-page'
import { SEBRequiredPage } from '@/components/exam/seb-required-page'
import { ExamSubmittedPage } from '@/components/exam/exam-submitted-page'
import { TeacherPageToolbar } from '@/components/teacher/page-toolbar'
import { ExamDataSync } from '@/components/exam/exam-data-sync'
import { StudentNavigator } from '@/components/exam/student-navigator'
import { StudentSnapshotProvider } from '@/contexts/student-snapshot-context'
import { ExamPageContextProvider } from '@/contexts/exam-page-context'
import { isSEBRequest, type ExamSettings } from '@/lib/seb'
import { validateExamToken, validateExamSession } from '@/lib/exam-tokens'
import { getPublicLayers } from '@/lib/public-page-data'
import type { Metadata } from 'next'

interface PageProps {
  params: Promise<{
    domain: string
    skriptSlug: string
    pageSlug: string
  }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

// Exam rendering reads headers() + cookies() for SEB detection and exam-session
// auth, so this route is inherently dynamic. The regular public route at
// /[domain]/[skriptSlug]/[pageSlug] is ISR-cached and redirects exam pages here.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pageSlug } = await params
  return {
    title: `Exam: ${pageSlug}`,
    robots: 'noindex, nofollow',
  }
}

export default async function ExamPage({ params, searchParams }: PageProps) {
  const { domain, skriptSlug, pageSlug } = await params
  const resolvedSearchParams = await searchParams

  const teacher = await getTeacherByUsernameDeduped(domain)
  if (!teacher) notFound()

  const content = await getPublishedPage(teacher.id, skriptSlug, pageSlug, domain)
  if (!content) notFound()

  const { collection, skript, page } = content

  // Defensive: if someone hits /exam/... for a non-exam page, redirect back
  // to the canonical public URL. Shouldn't happen via normal flow.
  if (page.pageType !== 'exam') {
    redirect(`/${domain}/${skriptSlug}/${pageSlug}`)
  }

  const headersList = await headers()
  const cookieStore = await cookies()
  const examSettings = page.examSettings as ExamSettings | null
  const currentUrl = `/exam/${domain}/${skriptSlug}/${pageSlug}`
  const loginUrl = `/auth/signin?callbackUrl=${encodeURIComponent(currentUrl)}`

  // Auth priority: 1) SEB token (one-time), 2) exam session cookie, 3) NextAuth.
  let authenticatedUserId: string | null = null
  let authenticatedViaToken = false
  let authenticatedViaExamSession = false

  const sebToken = typeof resolvedSearchParams.seb_token === 'string'
    ? resolvedSearchParams.seb_token
    : undefined

  if (sebToken && isSEBRequest(headersList)) {
    authenticatedUserId = await validateExamToken(sebToken, page.id)
    if (authenticatedUserId) {
      authenticatedViaToken = true
      // Server Components can't set cookies, so hand off to the start-session
      // API which sets the exam_session cookie and redirects back here
      // without seb_token.
      const startSessionUrl = `/api/exams/${page.id}/start-session?` +
        `userId=${encodeURIComponent(authenticatedUserId)}&` +
        `skriptId=${encodeURIComponent(skript.id)}&` +
        `returnUrl=${encodeURIComponent(currentUrl)}`
      redirect(startSessionUrl)
    }
  }

  if (!authenticatedUserId && isSEBRequest(headersList)) {
    const examSessionCookie = cookieStore.get('exam_session')?.value
    if (examSessionCookie) {
      authenticatedUserId = await validateExamSession(examSessionCookie, skript.id)
      if (authenticatedUserId) {
        authenticatedViaExamSession = true
      }
    }
  }

  if (!authenticatedUserId) {
    const session = await getServerSession(authOptions)
    authenticatedUserId = session?.user?.id || null
  }

  // Gate 1: must be authenticated
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

  const studentId = authenticatedUserId
  const hasUnlockForAll = examSettings?.unlockForAll === true

  const studentUnlock = !hasUnlockForAll ? await prisma.pageUnlock.findFirst({
    where: { pageId: page.id, studentId }
  }) : null

  const classUnlock = !hasUnlockForAll ? await prisma.pageUnlock.findFirst({
    where: {
      pageId: page.id,
      classId: { not: null },
      class: { memberships: { some: { studentId } } }
    }
  }) : null

  const hasUnlock = hasUnlockForAll || studentUnlock || classUnlock

  // Teacher-author detection: SkriptAuthor, or owning the site the collection
  // sits on (org-admin membership for org-owned sites).
  const skriptAuthorRecord = await prisma.skriptAuthor.findFirst({
    where: { skriptId: skript.id, userId: studentId, permission: 'author' }
  })
  let isSiteOwner = false
  if (!skriptAuthorRecord && collection) {
    const collectionWithSite = await prisma.collection.findUnique({
      where: { id: collection.id },
      select: { site: { select: { userId: true, organizationId: true } } },
    })
    if (collectionWithSite?.site) {
      if (collectionWithSite.site.userId === studentId) {
        isSiteOwner = true
      } else if (collectionWithSite.site.organizationId) {
        const membership = await prisma.organizationMember.findFirst({
          where: {
            organizationId: collectionWithSite.site.organizationId,
            userId: studentId,
            role: { in: ['owner', 'admin'] },
          },
          select: { id: true },
        })
        if (membership) isSiteOwner = true
      }
    }
  }
  const isTeacherAuthor = !!skriptAuthorRecord || isSiteOwner

  // Gate 2: must have unlock OR be the teacher
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

  let unlockedClassesForExam: { id: string; name: string }[] = []
  if (isTeacherAuthor) {
    const unlocks = await prisma.pageUnlock.findMany({
      where: { pageId: page.id, classId: { not: null } },
      include: { class: { select: { id: true, name: true, teacherId: true } } }
    })
    unlockedClassesForExam = unlocks
      .filter(u => u.class?.teacherId === studentId)
      .map(u => ({ id: u.class!.id, name: u.class!.name }))
  }

  let examState: 'closed' | 'lobby' | 'open' | null = null
  if (!isTeacherAuthor && classUnlock?.classId) {
    const stateRecord = await prisma.examState.findUnique({
      where: { pageId_classId: { pageId: page.id, classId: classUnlock.classId } },
      select: { state: true }
    })
    examState = (stateRecord?.state as 'closed' | 'lobby' | 'open') || 'closed'
  }

  // Gate 3: already submitted → show submitted page
  if (!isTeacherAuthor) {
    const existingSubmission = await prisma.examSubmission.findUnique({
      where: { pageId_studentId: { pageId: page.id, studentId } },
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

  // Gate 4: SEB required but request is not from SEB
  if (examSettings?.requireSEB && !isTeacherAuthor && !authenticatedViaToken && !authenticatedViaExamSession) {
    if (!isSEBRequest(headersList)) {
      return <SEBRequiredPage pageTitle={page.title} pageId={page.id} />
    }
  }

  // Gate 5: closed state blocks students
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

  // Fetch public annotations, snaps, and sticky notes (same as non-exam path)
  const { publicAnnotations, publicSnaps, publicStickyNotes } = await getPublicLayers(page.id)

  // Layout: the /exam/... segment doesn't inherit the [domain] sidebar layout,
  // so render PublicSiteLayout inline. During exams students benefit from the
  // same chrome (sidebar, typography, theme) as the regular public route.
  const layoutTeacher = await getTeacherWithLayout(domain)
  if (!layoutTeacher) notFound()
  const fullSiteStructure = await getFullSiteStructure(layoutTeacher.id, domain)

  const teacherForLayout = {
    name: layoutTeacher.name || layoutTeacher.pageSlug || 'Unknown',
    pageSlug: layoutTeacher.pageSlug || domain,
    pageName: layoutTeacher.pageName || null,
    pageDescription: layoutTeacher.pageDescription || null,
    pageIcon: layoutTeacher.pageIcon || null,
    bio: layoutTeacher.bio || null,
    title: layoutTeacher.title || null,
  }

  const isExamStudent = !isTeacherAuthor && (authenticatedViaToken || authenticatedViaExamSession)

  // SEB-authenticated students have no NextAuth session, so without an
  // ExamSessionProvider in the tree useUserDataContext treats them as
  // unauthenticated and skips the cloud-sync queue. That keeps Check/Run
  // checkpoints local-only and the teacher's PythonProgressBar can't see
  // any updates. Fetch name/email for the indicator chips and hand them to
  // ExamDataSync so useSyncedUserData.updateData() will queueSync().
  let examUserName: string | null = null
  let examUserEmail: string | null = null
  if (isExamStudent) {
    const examUser = await prisma.user.findUnique({
      where: { id: studentId },
      select: { name: true, email: true },
    })
    examUserName = examUser?.name ?? null
    examUserEmail = examUser?.email ?? null
  }

  const body = (
    <>
      {isTeacherAuthor && (
        <TeacherPageToolbar
          pageId={page.id}
          pageType="exam"
          unlockedClasses={unlockedClassesForExam}
        />
      )}
      <PublicPageBody
        page={page}
        skriptId={skript.id}
        publicAnnotations={publicAnnotations}
        publicSnaps={publicSnaps}
        publicStickyNotes={publicStickyNotes}
        isExamStudent={isExamStudent}
      />
      {isTeacherAuthor && <StudentNavigator pageId={page.id} />}
    </>
  )

  return (
    <PublicSiteLayout
      teacher={teacherForLayout}
      siteStructure={fullSiteStructure}
      sidebarBehavior={(layoutTeacher.sidebarBehavior as 'contextual' | 'full') || 'full'}
      typographyPreference={(layoutTeacher.typographyPreference as 'modern' | 'classic') || 'modern'}
    >
      <ExamPageContextProvider>
      {isExamStudent ? (
        <ExamDataSync
          userId={studentId}
          userName={examUserName}
          userEmail={examUserEmail}
          pageId={page.id}
        >
          {body}
        </ExamDataSync>
      ) : (
        // Snapshot provider gates on isTeacher + selectedStudent internally,
        // so it's inert for non-teacher non-author viewers and for the
        // teacher when no student is picked. Cheap to mount unconditionally.
        <StudentSnapshotProvider pageId={page.id} enabled={isTeacherAuthor}>
          {body}
        </StudentSnapshotProvider>
      )}
      </ExamPageContextProvider>
    </PublicSiteLayout>
  )
}
