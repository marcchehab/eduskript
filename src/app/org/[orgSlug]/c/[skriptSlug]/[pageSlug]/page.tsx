import { notFound } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getOrgPublishedPage, getOrgFullSiteStructure } from '@/lib/cached-queries'
import { buildSiteStructure } from '@/lib/site-structure'

interface PageProps {
  params: Promise<{
    orgSlug: string
    skriptSlug: string
    pageSlug: string
  }>
}

// Enable ISR - pages are cached until explicitly invalidated via revalidateTag
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, skriptSlug, pageSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return { title: 'Page Not Found' }
    }

    const content = await getOrgPublishedPage(
      organization.id,
      orgSlug,
      skriptSlug,
      pageSlug
    )

    if (!content) {
      return { title: 'Page Not Found', robots: 'noindex' }
    }

    const title = `${content.page.title} | ${organization.name}`
    const description = content.collection?.description || `${content.page.title} by ${organization.name}`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'article',
        siteName: organization.name,
        url: `/org/${orgSlug}/c/${skriptSlug}/${pageSlug}`
      },
      twitter: { card: 'summary_large_image', title, description }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return { title: 'Eduskript' }
  }
}

export default async function OrgPublicPage({ params }: PageProps) {
  const { orgSlug, skriptSlug, pageSlug } = await params

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

  const content = await getOrgPublishedPage(
    organization.id,
    orgSlug,
    skriptSlug,
    pageSlug
  )

  if (!content) {
    notFound()
  }

  const { collection, skript, page, allPages } = content

  // Fetch public annotations and snaps
  const [publicAnnotations, publicSnaps] = await Promise.all([
    prisma.userData.findMany({
      where: { adapter: 'annotations', itemId: page.id, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } }
    }),
    prisma.userData.findMany({
      where: { adapter: 'snaps', itemId: page.id, targetType: 'page' },
      select: { data: true, userId: true, user: { select: { name: true } } }
    })
  ])

  // Build site structure for navigation
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

  const orgAsTeacher = {
    name: organization.name,
    pageSlug: `org/${orgSlug}`,
    pageName: organization.name,
    pageDescription: organization.description,
    pageIcon: organization.showIcon ? (organization.iconUrl || 'default') : null,
    bio: null,
    title: null
  }

  const currentPath = `/${skriptSlug}/${pageSlug}`

  const fullSiteStructure = organization.sidebarBehavior === 'full'
    ? await getOrgFullSiteStructure(organization.id, orgSlug)
    : undefined

  return (
    <PublicSiteLayout
      teacher={orgAsTeacher}
      siteStructure={siteStructure}
      currentPath={currentPath}
      fullSiteStructure={fullSiteStructure}
      sidebarBehavior={organization.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference="modern"
      routePrefix={`/org/${orgSlug}/c`}
      homeUrl={`/org/${orgSlug}`}
      pageId={page.id}
    >
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        <article className="prose-theme">
          <AnnotationWrapper pageId={page.id} content={page.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps}>
            <ServerMarkdownRenderer
              content={page.content}
              skriptId={skript.id}
              pageId={page.id}
              organizationSlug={orgSlug}
            />
          </AnnotationWrapper>
        </article>
      </div>
    </PublicSiteLayout>
  )
}
