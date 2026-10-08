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
import { ExamWaitingRoom } from '@/components/exam/exam-waiting-room'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import { ExamDataSync } from '@/components/exam/exam-data-sync'
import { HandInButton } from '@/components/exam/hand-in-button'
import { StudentNavigator } from '@/components/exam/student-navigator'
import { StudentSnapshotProvider } from '@/contexts/student-snapshot-context'
import { TeacherExamGrading } from '@/components/exam/teacher-exam-grading'
import { ExamReviewProvider } from '@/contexts/exam-review-context'
import { ReturnedExamSummary } from '@/components/exam/returned-exam-summary'
import { ExamPageContextProvider } from '@/contexts/exam-page-context'
import { getOrCreateActiveExamKey } from '@/lib/exam-keys'
import { getExamClassesForTeacher } from '@/lib/scoring/auth'
import { isStudentReturned } from '@/lib/scoring/return-state'
import { resolveExamStateDetail, type ExamLifecycleState } from '@/lib/exam-state'
import { isSEBRequest, type ExamSettings } from '@/lib/seb'
import { validateExamToken, validateExamSession } from '@/lib/exam-tokens'
import { getPublicLayers } from '@/lib/public-page-data'
import { getSiteAccess } from '@/lib/site-access'
import { CurrentSiteProvider } from '@/contexts/current-site-context'
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

  const content = await getPublishedPage(teacher.siteId, skriptSlug, pageSlug, domain)
  if (!content) notFound()

  const { skript, page } = content
  // Site scoping: everything below (submissions, exam state, public layer,
  // client user data) is keyed on the site this route renders.
  const siteId = teacher.siteId

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
        `siteId=${encodeURIComponent(siteId)}&` +
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

  // Teacher view = the viewer MANAGES this site (personal owner / org
  // owner+admin, src/lib/site-access.ts). Skript authorship alone grants
  // nothing here: an author viewing the exam on someone else's site sees it as
  // a student would (rule: authorship gives no rights on student data).
  const siteAccess = await getSiteAccess(studentId, siteId)
  const isTeacherAuthor = !!siteAccess?.canManage

  // Submission state — needed both for the returned-review bypass and the
  // already-submitted gate. A RETURNED exam stays viewable read-only regardless
  // of the current lifecycle state (even 'hidden'), so setting an exam back to
  // hidden never hides a student's returned exam. A submitted-but-not-returned
  // exam shows the "submitted" page regardless of state too.
  let isReturnedReview = false
  let submittedAt: Date | null = null
  if (!isTeacherAuthor) {
    const existingSubmission = await prisma.examSubmission.findUnique({
      where: { pageId_studentId_siteId: { pageId: page.id, studentId, siteId } },
      select: { submittedAt: true }
    })
    if (existingSubmission) {
      // Returned state is derived from the exam log (single source of truth), so a
      // take-back drops the student back to the "submitted" view automatically.
      if (await isStudentReturned(page.id, studentId, siteId)) isReturnedReview = true
      else submittedAt = existingSubmission.submittedAt
    }
  }

  // Effective exam lifecycle state for this student (the single source of truth —
  // see lib/exam-state). Teachers and unlockForAll pages bypass to 'open'.
  const examResolution = isTeacherAuthor || hasUnlockForAll
    ? { state: 'open' as ExamLifecycleState, classId: null, isStudentOverride: false }
    : await resolveExamStateDetail(page.id, studentId, siteId)
  const examState: ExamLifecycleState = examResolution.state

  // Classes shown in the teacher's class toolbar: assigned (has an ExamState row)
  // OR having a submitted answer. See getExamClassesForTeacher. `studentId` here
  // is the current (teacher) user id.
  let unlockedClassesForExam: { id: string; name: string }[] = []
  // Classes only exist on personal sites (owner = class teacher); org sites
  // have none.
  if (siteAccess?.isOwner) {
    unlockedClassesForExam = await getExamClassesForTeacher(page.id, studentId, siteId)
  }

  // Gate: already submitted (not yet returned) → submitted page, before the
  // access gate so a student who submitted then had the exam closed/hidden still
  // sees "submitted", not "locked".
  if (submittedAt) {
    return (
      <ExamSubmittedPage
        pageTitle={page.title}
        pageId={page.id}
        submittedAt={submittedAt}
      />
    )
  }

  // Access gate: not assigned ('hidden') or not yet enterable ('closed') blocks
  // students — except a returned review (handled above/below). 'lobby' and 'open'
  // fall through; the client shows the waiting room while in lobby.
  if (!isTeacherAuthor && !isReturnedReview && (examState === 'hidden' || examState === 'closed')) {
    return (
      <ExamLockedPage
        pageTitle={page.title}
        teacherName={teacher.name || teacher.pageSlug || 'Unknown'}
        isLoggedIn={true}
        loginUrl={loginUrl}
      />
    )
  }

  // Gate: SEB required but request is not from SEB (skipped for a returned
  // review — the student is just looking at their graded exam, not taking it).
  if (examSettings?.requireSEB && !isTeacherAuthor && !isReturnedReview && !authenticatedViaToken && !authenticatedViaExamSession) {
    if (!isSEBRequest(headersList)) {
      return <SEBRequiredPage pageTitle={page.title} pageId={page.id} />
    }
  }

  const isExamStudent = !isTeacherAuthor && (authenticatedViaToken || authenticatedViaExamSession)

  // Anyone taking the exam (SEB token/session OR a logged-in non-SEB student)
  // gets an in-page "Hand in" button. The /exam route renders via
  // PublicSiteLayout, not the SEB ExamLayout/ExamHeader, so without this a
  // non-SEB student (e.g. a mock exam) had no way to submit — and crucially the
  // hand-in is what snapshots code editors into 'handin' checkpoints for the
  // grader. Teachers (authors) and returned-exam reviewers never see it.
  const isExamTaker = !isTeacherAuthor && !isReturnedReview && !!studentId

  // The exam author's RSA-OAEP public key — used to encrypt the offline backup
  // the student's browser auto-saves on hand-in. Only the author can decrypt it
  // (recovery endpoint). Fetched only when someone is actually taking the exam.
  // Best-effort: the backup is defensive and must NEVER block exam-taking — a
  // key-service error degrades to "no backup" (HandInButton hides the affordance
  // when the key is null) rather than failing the page render for students.
  let backupKey: { publicKeyJwk: JsonWebKey; keyId: string } | null = null
  if (isExamTaker) {
    try {
      backupKey = await getOrCreateActiveExamKey(teacher.id)
    } catch (err) {
      console.error('[exam] backup key unavailable, continuing without backup:', err)
    }
  }

  // Gate: 'lobby' — the student may enter but the exam hasn't started. The
  // waiting room holds them on an SSE connection to the exam-state channel and
  // reloads as soon as the teacher moves the state (see ExamWaitingRoom).
  // Teachers, unlockForAll pages and returned reviews never reach this (their
  // state is forced to 'open' / handled above).
  if (examState === 'lobby' && !isTeacherAuthor && !isReturnedReview && examResolution.classId) {
    return (
      <CurrentSiteProvider siteId={siteId}>
        <ExamWaitingRoom
          pageId={page.id}
          classId={examResolution.classId}
          examTitle={page.title}
          studentId={studentId}
          skriptId={skript.id}
          hasStudentOverride={examResolution.isStudentOverride}
          backupPublicKeyJwk={backupKey?.publicKeyJwk}
          backupKeyId={backupKey?.keyId}
        />
      </CurrentSiteProvider>
    )
  }

  // Fetch public annotations, snaps, and sticky notes (same as non-exam path)
  const { publicAnnotations, publicSnaps, publicStickyNotes } = await getPublicLayers(page.id, siteId)

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
    titleStyle: layoutTeacher.titleStyle || null,
    logoUrl: layoutTeacher.logoUrl || null,
    bio: layoutTeacher.bio || null,
    title: layoutTeacher.title || null,
  }

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
        <ClassToolbar
          pageId={page.id}
          pageType="exam"
          unlockedClasses={unlockedClassesForExam}
          siteId={siteId}
        />
      )}
      <PublicPageBody
        page={page}
        skriptId={skript.id}
        publicAnnotations={publicAnnotations}
        publicSnaps={publicSnaps}
        publicStickyNotes={publicStickyNotes}
        isExamStudent={isExamStudent}
        teacherPageSlug={teacher.pageSlug}
        siteId={siteId}
        pageLanguage={teacher.pageLanguage}
      />
      {isExamTaker && (
        <div className="mt-10 flex flex-col items-center gap-2 border-t border-border pt-6">
          <HandInButton
            pageId={page.id}
            studentId={studentId}
            skriptId={skript.id}
            publicKeyJwk={backupKey?.publicKeyJwk}
            keyId={backupKey?.keyId}
          />
        </div>
      )}
      {isTeacherAuthor && <StudentNavigator pageId={page.id} />}
    </>
  )

  return (
    // The /exam segment doesn't inherit [domain]/(site)/layout.tsx, so mount
    // the site context here — the client user-data layer keys every record on
    // it (src/lib/userdata/userDataService.ts).
    <CurrentSiteProvider siteId={siteId}>
    <PublicSiteLayout
      teacher={teacherForLayout}
      siteStructure={fullSiteStructure}
      sidebarBehavior={(layoutTeacher.sidebarBehavior as 'contextual' | 'full') || 'full'}
      typographyPreference={(layoutTeacher.typographyPreference as 'modern' | 'classic') || 'modern'}
      // Lets AuthButton turn the profile button into an "edit this page" link for
      // the author (same as normal pages). On normal routes the layout derives
      // pageId from siteStructure; the /exam route passes it explicitly.
      pageId={page.id}
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
      ) : isReturnedReview ? (
        // Returned exam: student reviews their own graded answers read-only.
        <ExamReviewProvider pageId={page.id} mode="review" studentId={studentId}>
          <ReturnedExamSummary />
          {body}
        </ExamReviewProvider>
      ) : (
        // Snapshot provider gates on isTeacher + selectedStudent internally,
        // so it's inert for non-teacher non-author viewers and for the
        // teacher when no student is picked. Cheap to mount unconditionally.
        <StudentSnapshotProvider pageId={page.id} enabled={isTeacherAuthor}>
          <TeacherExamGrading pageId={page.id} enabled={isTeacherAuthor}>
            {body}
          </TeacherExamGrading>
        </StudentSnapshotProvider>
      )}
      </ExamPageContextProvider>
    </PublicSiteLayout>
    </CurrentSiteProvider>
  )
}
