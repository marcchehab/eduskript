import { notFound } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ExportPDF } from '@/components/public/export-pdf'
import { DevClearDataButton } from '@/components/dev/dev-clear-data-button'
import { ExamLockedPage } from '@/components/exam/exam-locked-page'
import { SEBRequiredPage } from '@/components/exam/seb-required-page'
import { isSEBRequest, type ExamSettings } from '@/lib/seb'
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

export default async function OrgTeacherContentPage({ params }: PageProps) {
  const { orgSlug, pageSlug, collectionSlug, skriptSlug, contentPageSlug } = await params

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

  if (!page || !page.skript.collectionSkripts[0]) {
    notFound()
  }

  const skript = page.skript
  const collection = skript.collectionSkripts[0].collection
  const allPages = skript.pages

  // EXAM ACCESS CONTROL
  if (page.pageType === 'exam') {
    const session = await getServerSession(authOptions)
    const currentUrl = `/org/${orgSlug}/${pageSlug}/${collectionSlug}/${skriptSlug}/${contentPageSlug}`
    const loginUrl = `/auth/signin?callbackUrl=${encodeURIComponent(currentUrl)}`

    // Check 1: User must be logged in
    if (!session?.user?.id) {
      return (
        <ExamLockedPage
          pageTitle={page.title}
          teacherName={teacher.name || teacher.pageName || 'Unknown'}
          isLoggedIn={false}
          loginUrl={loginUrl}
        />
      )
    }

    const studentId = session.user.id

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

    if (!hasUnlock) {
      // Allow teachers (page authors) to access their own exam pages
      const isTeacherAuthor = await prisma.skriptAuthor.findFirst({
        where: { skriptId: skript.id, userId: studentId, permission: 'author' }
      }) || await prisma.collectionAuthor.findFirst({
        where: { collectionId: collection.id, userId: studentId, permission: 'author' }
      })

      if (!isTeacherAuthor) {
        return (
          <ExamLockedPage
            pageTitle={page.title}
            teacherName={teacher.name || teacher.pageName || 'Unknown'}
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
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10" style={{ maxWidth: 'min(1280px, calc(100vw - 48px))', marginLeft: 'auto', marginRight: 'auto' }}>
        <article className="prose-theme">
          <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} isPageAuthor={isPageAuthor}>
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

      <DevClearDataButton pageId={page.id} />
    </PublicSiteLayout>
  )
}
