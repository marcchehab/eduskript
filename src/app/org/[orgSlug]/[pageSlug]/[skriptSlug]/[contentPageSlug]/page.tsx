import { notFound, redirect } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getPublicLayers } from '@/lib/public-page-data'
import { ExamSessionIndicator } from '@/components/exam/exam-session-indicator'
import { ExamLockedPage } from '@/components/exam/exam-locked-page'
import { SEBRequiredPage } from '@/components/exam/seb-required-page'
import { ExamSubmittedPage } from '@/components/exam/exam-submitted-page'
import { ExamLayout } from '@/components/exam/exam-layout'
import { ExamWaitingRoom } from '@/components/exam/exam-waiting-room'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import { ExamDataSync } from '@/components/exam/exam-data-sync'
import { isSEBRequest, type ExamSettings } from '@/lib/seb'
import { validateExamToken, validateExamSession } from '@/lib/exam-tokens'
import { getOrCreateActiveExamKey } from '@/lib/exam-keys'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { headers } from 'next/headers'
import { getFullSiteStructure } from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'

interface PageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
    skriptSlug: string
    contentPageSlug: string
  }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, pageSlug, skriptSlug, contentPageSlug } = await params

  try {
    const orgSite = await prisma.site.findUnique({
      where: { slug: orgSlug },
      select: { organization: { select: { id: true, name: true } } }
    })
    const organization = orgSite?.organization

    if (!organization) {
      return { title: 'Page Not Found' }
    }

    const teacher = await prisma.user.findFirst({
      where: {
        site: { slug: pageSlug },
        organizationMemberships: { some: { organizationId: organization.id } }
      },
      select: { id: true, name: true, site: { select: { pageName: true } } }
    })

    if (!teacher) {
      return { title: 'Teacher Not Found' }
    }

    const page = await prisma.page.findFirst({
      where: {
        slug: contentPageSlug,
        skript: {
          slug: skriptSlug,
          authors: { some: { userId: teacher.id } }
        }
      },
      select: { title: true }
    })

    if (!page) {
      return { title: 'Page Not Found', robots: 'noindex' }
    }

    const teacherName = teacher.site?.pageName || teacher.name || 'Teacher'
    const title = `${page.title} | ${teacherName} | ${organization.name}`

    return {
      title,
      description: `${page.title} by ${teacherName}`,
      openGraph: {
        title,
        type: 'article',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}/${skriptSlug}/${contentPageSlug}`
      },
      twitter: { card: 'summary_large_image', title }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return { title: 'Eduskript' }
  }
}

export default async function OrgTeacherContentPage({ params, searchParams }: PageProps) {
  const { orgSlug, pageSlug, skriptSlug, contentPageSlug } = await params
  const resolvedSearchParams = await searchParams

  const orgSiteRow = await prisma.site.findUnique({
    where: { slug: orgSlug },
    select: {
      pageDescription: true,
      pageIcon: true,
      showIcon: true,
      organization: { select: { id: true, name: true } }
    }
  })
  const organization = orgSiteRow?.organization
    ? {
        ...orgSiteRow.organization,
        description: orgSiteRow.pageDescription,
        iconUrl: orgSiteRow.pageIcon,
        showIcon: orgSiteRow.showIcon,
      }
    : null

  if (!organization) {
    notFound()
  }

  const teacher = await prisma.user.findFirst({
    where: {
      site: { slug: pageSlug },
      organizationMemberships: { some: { organizationId: organization.id } }
    },
    select: {
      id: true,
      name: true,
      bio: true,
      title: true,
      site: {
        select: {
          slug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          sidebarBehavior: true,
          typographyPreference: true,
        },
      },
    }
  })

  if (!teacher) {
    notFound()
  }

  // Find page via skript unique slug
  const page = await prisma.page.findFirst({
    where: {
      slug: contentPageSlug,
      skript: {
        slug: skriptSlug,
        OR: [
          { authors: { some: { userId: teacher.id } } },
          { collectionSkripts: { some: { collection: { site: { userId: teacher.id } } } } }
        ]
      }
    },
    include: {
      skript: {
        include: {
          collectionSkripts: {
            include: { collection: true },
            orderBy: { order: 'asc' },
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

  if (!page) {
    notFound()
  }

  const skript = page.skript
  const collectionSkript = skript.collectionSkripts[0]
  const collection = collectionSkript?.collection
  const allPages = skript.pages

  // EXAM ACCESS CONTROL
  let isInExamSession = false
  let examSessionUserName: string | null = null
  let examSessionUserEmail: string | null = null
  let examState: 'closed' | 'lobby' | 'open' | null = null
  let examClassId: string | null = null
  let isTeacherViewingExam = false
  let unlockedClassesForExam: { id: string; name: string }[] = []
  let existingSubmission: { submittedAt: Date } | null = null
  let examAuthenticatedUserId: string | null = null

  if (page.pageType === 'exam') {
    const headersList = await headers()
    const cookieStore = await cookies()
    const examSettings = page.examSettings as ExamSettings | null
    const currentUrl = `/org/${orgSlug}/${pageSlug}/${skriptSlug}/${contentPageSlug}`
    const loginUrl = `/auth/signin?callbackUrl=${encodeURIComponent(currentUrl)}`

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
        // Immediately create exam session so auth persists across refreshes.
        // Redirect to start-session API (Server Components can't set cookies),
        // which sets the cookie and redirects back here without seb_token.
        const currentUrl = `/org/${orgSlug}/${pageSlug}/${skriptSlug}/${contentPageSlug}`
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
          isInExamSession = true
          const examUser = await prisma.user.findUnique({
            where: { id: authenticatedUserId },
            select: { name: true, email: true }
          })
          examSessionUserName = examUser?.name || null
          examSessionUserEmail = examUser?.email || null
        }
      }
    }

    if (!authenticatedUserId) {
      const session = await getServerSession(authOptions)
      authenticatedUserId = session?.user?.id || null
    }

    if (!authenticatedUserId) {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.site?.pageName || 'Unknown'}
          isLoggedIn={false}
          loginUrl={loginUrl}
        />
      )
    }

    const studentId = authenticatedUserId
    examAuthenticatedUserId = authenticatedUserId

    // Skip unlock check if exam is unlocked for all
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

    if (!hasUnlock && !isTeacherAuthor) {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.site?.pageName || 'Unknown'}
          isLoggedIn={true}
          loginUrl={loginUrl}
        />
      )
    }

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

    if (!isTeacherAuthor && classUnlock?.classId) {
      examClassId = classUnlock.classId
      const stateRecord = await prisma.examState.findUnique({
        where: { pageId_classId: { pageId: page.id, classId: classUnlock.classId } },
        select: { state: true }
      })
      examState = (stateRecord?.state as 'closed' | 'lobby' | 'open') || 'closed'
    }

    if (!isTeacherAuthor) {
      const submission = await prisma.examSubmission.findUnique({
        where: { pageId_studentId: { pageId: page.id, studentId } },
        select: { submittedAt: true }
      })
      if (submission) {
        existingSubmission = { submittedAt: submission.submittedAt }
      }
    }

    if (!isTeacherAuthor && existingSubmission) {
      return (
        <ExamSubmittedPage
          pageTitle={page.title}
          pageId={page.id}
          submittedAt={existingSubmission.submittedAt}
        />
      )
    }

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

    if (!isTeacherAuthor && examState === 'closed') {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.site?.pageName || 'Unknown'}
          isLoggedIn={true}
          loginUrl={`/auth/signin?callbackUrl=${encodeURIComponent(`/org/${orgSlug}/${pageSlug}/${skriptSlug}/${contentPageSlug}`)}`}
        />
      )
    }

  }

  const { publicAnnotations, publicSnaps, publicStickyNotes } = await getPublicLayers(page.id)

  let isPageAuthor = false
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    const skriptAuthor = await prisma.skriptAuthor.findFirst({
      where: { skriptId: skript.id, userId: session.user.id, permission: 'author' }
    })
    isPageAuthor = !!skriptAuthor
  }

  // Build site structure
  const siteStructure = collection
    ? buildSiteStructure([{
        id: collection.id,
        title: collection.title,
        accentColor: collection.accentColor,
        collectionSkripts: [{
          order: collectionSkript?.order ?? 0,
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
        skripts: [{
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          order: 0,
          pages: allPages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
        }]
      }]

  const teacherSite = teacher.site
  const fullSiteStructure = teacherSite?.sidebarBehavior === 'full'
    ? await getFullSiteStructure(teacher.id, teacherSite.slug)
    : undefined

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacherSite?.slug || pageSlug,
    pageName: teacherSite?.pageName || null,
    pageDescription: teacherSite?.pageDescription || null,
    pageIcon: teacherSite?.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${skriptSlug}/${contentPageSlug}`

  const isExamStudent = isInExamSession && !isTeacherViewingExam

  const examContent = (
    <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
      <article className="prose-theme">
        <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} publicStickyNotes={publicStickyNotes} isPageAuthor={isPageAuthor} isExamStudent={isExamStudent}>
          <ServerMarkdownRenderer
            content={page.content}
            skriptId={skript.id}
            pageId={page.id}
            organizationSlug={orgSlug}
          />
        </AnnotationWrapper>
      </article>
    </div>
  )

  if (isInExamSession && !isTeacherViewingExam && examAuthenticatedUserId) {
    // Lazy-load (or fetch) the page-owning teacher's active exam encryption
    // key. Embedded in the page render so the student's browser can encrypt
    // an offline backup at any time, including after a hand-in failure. The
    // private half stays server-side; the recovery endpoint uses it to
    // decrypt uploaded .examfile blobs.
    const backupKey = await getOrCreateActiveExamKey(teacher.id)

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
            typographyPreference={(teacher.site?.typographyPreference as 'modern' | 'classic') || 'modern'}
            backupPublicKeyJwk={backupKey.publicKeyJwk}
            backupKeyId={backupKey.keyId}
            studentId={examAuthenticatedUserId}
            skriptId={skript.id}
          >
            <ExamWaitingRoom
              pageId={page.id}
              classId={examClassId}
              examTitle={page.title}
              backupPublicKeyJwk={backupKey.publicKeyJwk}
              backupKeyId={backupKey.keyId}
              studentId={examAuthenticatedUserId}
              skriptId={skript.id}
            />
          </ExamLayout>
        </ExamDataSync>
      )
    }

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
          typographyPreference={(teacher.site?.typographyPreference as 'modern' | 'classic') || 'modern'}
          backupPublicKeyJwk={backupKey.publicKeyJwk}
          backupKeyId={backupKey.keyId}
          studentId={examAuthenticatedUserId}
          skriptId={skript.id}
        >
          {examContent}
        </ExamLayout>
      </ExamDataSync>
    )
  }

  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={siteStructure}
      fullSiteStructure={fullSiteStructure}
      currentPath={currentPath}
      sidebarBehavior={(teacherSite?.sidebarBehavior as 'contextual' | 'full') || 'contextual'}
      typographyPreference={(teacher.site?.typographyPreference as 'modern' | 'classic') || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
      pageId={page.id}
      hideSidebar={page.pageType === 'exam'}
    >
      {/* Toolbar shows for teachers on their own page. On exam pages it carries
          the full exam controls (state, reopen) + the submissions list; on
          non-exam pages it's the submissions list alone. Suppressed when an
          exam student is actively in-session on this page. */}
      {(isTeacherViewingExam || (isPageAuthor && !isInExamSession)) && (
        <ClassToolbar
          pageId={page.id}
          pageType={page.pageType ?? 'standard'}
          unlockedClasses={unlockedClassesForExam}
        />
      )}

      {examContent}

      {isInExamSession && <ExamSessionIndicator userName={examSessionUserName} />}
    </PublicSiteLayout>
  )
}
