import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getOrgMembership } from '@/lib/org-auth'
import { getOrgFullSiteStructure } from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'

export const dynamic = 'force-dynamic'
export const dynamicParams = true

interface SkriptPageProps {
  params: Promise<{
    orgSlug: string
    skriptSlug: string
  }>
}

export async function generateMetadata({ params }: SkriptPageProps): Promise<Metadata> {
  const { orgSlug, skriptSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return { title: 'Organization Not Found' }
    }

    const adminMembers = await prisma.organizationMember.findMany({
      where: { organizationId: organization.id, role: { in: ['owner', 'admin'] } },
      select: { userId: true }
    })
    const orgAdminIds = adminMembers.map(m => m.userId)

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        OR: [
          { authors: { some: { userId: { in: orgAdminIds } } } },
          { collectionSkripts: { some: { collection: { authors: { some: { userId: { in: orgAdminIds } } } } } } }
        ]
      },
      select: { title: true }
    })

    if (!skript) {
      return { title: 'Skript Not Found' }
    }

    return {
      title: `${skript.title} | ${organization.name}`,
      description: `${skript.title} by ${organization.name}`
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return { title: 'Eduskript' }
  }
}

export default async function OrgSkriptPage({ params }: SkriptPageProps) {
  const { orgSlug, skriptSlug } = await params

  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      description: true,
      showIcon: true,
      iconUrl: true,
      sidebarBehavior: true
    }
  })

  if (!organization) {
    notFound()
  }

  // Check if user is org admin
  const session = await getServerSession(authOptions)
  const membership = session?.user?.id
    ? await getOrgMembership(session.user.id, organization.id)
    : null
  const isAdmin =
    session?.user?.isAdmin ||
    membership?.role === 'owner' ||
    membership?.role === 'admin'

  // Get org admins for content lookup
  const adminMembers = await prisma.organizationMember.findMany({
    where: {
      organizationId: organization.id,
      role: { in: ['owner', 'admin'] }
    },
    select: { userId: true }
  })
  const adminUserIds = adminMembers.map(m => m.userId)

  // Find skript by slug scoped to org admins
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      OR: [
        { authors: { some: { userId: { in: adminUserIds } } } },
        { collectionSkripts: { some: { collection: { authors: { some: { userId: { in: adminUserIds } } } } } } }
      ]
    },
    include: {
      collectionSkripts: {
        include: {
          collection: true
        },
        orderBy: { order: 'asc' },
        take: 1,
      },
      pages: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          order: true,
          isPublished: true
        }
      }
    }
  })

  if (!skript) {
    notFound()
  }

  // Authorization: Only admins can view unpublished skripts
  if (!skript.isPublished && !isAdmin) {
    notFound()
  }

  // Check for skript frontpage
  const frontPage = await prisma.frontPage.findFirst({
    where: {
      skriptId: skript.id,
      ...(isAdmin ? {} : { isPublished: true })
    }
  })

  // Fetch public annotations and snaps for this skript front page
  const [publicAnnotations, publicSnaps] = frontPage ? await Promise.all([
    prisma.userData.findMany({
      where: { adapter: 'annotations', itemId: frontPage.id, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } }
    }),
    prisma.userData.findMany({
      where: { adapter: 'snaps', itemId: frontPage.id, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } }
    })
  ]) : [[], []]

  const isPageAuthor = isAdmin
  const showFrontpage = frontPage?.content || isAdmin

  const collectionSkript = skript.collectionSkripts[0]
  const collection = collectionSkript?.collection

  if (showFrontpage) {
    const isPreviewMode = isAdmin && frontPage && !frontPage.isPublished

    // Build site structure
    const availablePages = skript.pages.filter(page => isAdmin || page.isPublished)
    const siteStructure = collection
      ? buildSiteStructure([{
          id: collection.id,
          title: collection.title,
          slug: collection.slug,
          accentColor: collection.accentColor,
          collectionSkripts: [{
            order: collectionSkript.order,
            skript: {
              ...skript,
              pages: availablePages
            }
          }]
        }], { onlyPublished: !isAdmin })
      : [{
          id: 'standalone',
          title: skript.title,
          slug: skript.slug,
          skripts: [{
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            order: 0,
            pages: availablePages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
          }]
        }]

    const orgAsTeacher = {
      name: organization.name,
      pageSlug: `org/${orgSlug}`,
      pageName: organization.name,
      pageDescription: organization.description,
      pageIcon: organization.showIcon ? (organization.iconUrl || 'default') : null,
      bio: null,
      title: null
    }

    const fullSiteStructure = organization.sidebarBehavior === 'full'
      ? await getOrgFullSiteStructure(organization.id, orgSlug)
      : undefined

    return (
      <PublicSiteLayout
        teacher={orgAsTeacher}
        siteStructure={siteStructure}
        rootSkripts={[]}
        fullSiteStructure={fullSiteStructure}
        sidebarBehavior={organization.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
        typographyPreference="modern"
        routePrefix={`/org/${orgSlug}/c`}
        homeUrl={`/org/${orgSlug}`}
      >
        <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
          {isPreviewMode && (
            <div className="flex items-center gap-2 px-3 py-1.5 mb-4 text-sm rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
              <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span><span className="font-semibold">Preview:</span> Not published yet. Only admins can see this.</span>
            </div>
          )}

          {frontPage?.content ? (
            <article className="prose-theme">
              <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} isPageAuthor={isPageAuthor}>
                <ServerMarkdownRenderer
                  content={frontPage.content}
                  skriptId={skript.id}
                  pageId={frontPage.id}
                  organizationSlug={orgSlug}
                />
              </AnnotationWrapper>
            </article>
          ) : isAdmin ? (
            <div className="text-center py-12">
              <h1 className="text-3xl font-bold mb-4">{skript.title}</h1>
              <p className="text-muted-foreground mb-6">
                This skript doesn&apos;t have a frontpage yet.
              </p>
              <Link
                href={`/dashboard/skripts/${skriptSlug}/frontpage`}
                className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Create Frontpage
              </Link>
            </div>
          ) : null}
        </div>
      </PublicSiteLayout>
    )
  }

  // No frontpage - redirect to first available page
  const firstPage = skript.pages.find(page => isAdmin || page.isPublished)

  if (firstPage) {
    return <SkriptRedirect redirectUrl={`/org/${orgSlug}/c/${skriptSlug}/${firstPage.slug}`} />
  }

  notFound()
}
