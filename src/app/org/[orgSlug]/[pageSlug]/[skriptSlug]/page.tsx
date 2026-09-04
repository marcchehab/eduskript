import { notFound } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { getOrgTeacherSkript } from '@/lib/cached-queries'
import { getTeacherSidebarData } from '@/lib/sidebar-items'
import { CurrentSiteProvider } from '@/contexts/current-site-context'
import { buildSiteStructure } from '@/lib/site-structure'
import { readExtraSettings } from '@/lib/settings'

interface PageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
    skriptSlug: string
  }>
}

// ISR. The route previously read the session to show unpublished skripts to
// their author, which forced a dynamic render for every visitor. It now serves
// published content only, so the response is identical for everyone and can be
// cached. Note the failure mode this replaces: under `revalidate = false` +
// generateStaticParams() the route is static-with-on-demand-generation, where
// reading cookies throws DYNAMIC_SERVER_USAGE and returned 500 on every
// eduskript.org/<teacher>/<skript> URL — so nothing here may read the session
// or cookies, transitively included.
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, pageSlug, skriptSlug } = await params

  try {
    // Same cached entry the component below uses, so metadata is free.
    const data = await getOrgTeacherSkript(orgSlug, pageSlug, skriptSlug)

    if (!data) {
      return { title: 'Skript Not Found', robots: 'noindex' }
    }

    const { organization, teacher, skript } = data
    const teacherName = teacher.sites[0]?.pageName || teacher.name || 'Teacher'
    const title = `${skript.title} | ${teacherName} | ${organization.name}`

    return {
      title,
      description: skript.description || `${skript.title} by ${teacherName}`,
      openGraph: {
        title,
        type: 'website',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}/${skriptSlug}`
      }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return { title: 'Eduskript' }
  }
}

export default async function OrgTeacherSkriptPage({ params }: PageProps) {
  const { orgSlug, pageSlug, skriptSlug } = await params

  // One cached lookup for org + teacher + skript (shared with generateMetadata).
  const data = await getOrgTeacherSkript(orgSlug, pageSlug, skriptSlug)

  if (!data) {
    notFound()
  }

  const { orgSite, teacher, skript } = data
  const organization = {
    ...data.organization,
    description: orgSite.pageDescription,
    iconUrl: orgSite.pageIcon,
    showIcon: orgSite.showIcon,
  }

  const collectionSkript = skript.collectionSkripts[0]
  const collection = collectionSkript?.collection

  // Check if current user is an author (to show unpublished content in sidebar)

  // Build site structure
  const siteStructure = collection
    ? buildSiteStructure([{
        id: collection.id,
        title: collection.title,
        accentColor: collection.accentColor,
        collectionSkripts: [{
          order: collectionSkript.order,
          skript: {
            id: skript.id,
            title: skript.title,
            slug: skript.slug,
            isPublished: skript.isPublished,
            pages: skript.pages.map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              isPublished: true,
              order: 0
            }))
          }
        }]
      }], { onlyPublished: true })
    : [{
        id: 'standalone',
        title: skript.title,
        skripts: [{
          id: skript.id,
          title: skript.title,
          slug: skript.slug,
          order: 0,
          pages: skript.pages.map(p => ({ id: p.id, title: p.title, slug: p.slug }))
        }]
      }]

  const teacherSite = teacher.sites[0]
  // Full mode: interleaved page-builder sidebar shared with the [domain]
  // layout (includes root skripts). Contextual keeps the single-skript
  // structure above.
  const sidebarData = (teacherSite?.sidebarBehavior || 'full') === 'full'
    ? await getTeacherSidebarData(teacher.id, teacherSite.slug)
    : undefined

  const teacherSiteExtra = readExtraSettings(teacherSite)
  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacherSite?.slug || pageSlug,
    pageName: teacherSite?.pageName || null,
    pageDescription: teacherSite?.pageDescription || null,
    pageIcon: teacherSite?.pageIcon || null,
    titleStyle: teacherSiteExtra.titleStyle ?? 'icon',
    logoUrl: teacherSiteExtra.logoUrl ?? null,
    bio: teacher.bio || null,
    title: teacher.title || null,
    billingPlan: teacher.billingPlan,
    supporterBadgeHidden: teacherSiteExtra.supporterBadgeHidden ?? false,
    supporterBadgeMessage: teacherSiteExtra.supporterBadgeMessage ?? null,
  }

  const currentPath = `/${skriptSlug}`

  return (
    <CurrentSiteProvider siteId={teacherSite?.id ?? null} organizationId={organization.id}>
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={siteStructure}
      sidebarItems={sidebarData?.sidebarItems}
      fullSiteStructure={sidebarData?.fullSiteStructure}
      currentPath={currentPath}
      sidebarBehavior={(teacherSite?.sidebarBehavior as 'contextual' | 'full') || 'full'}
      typographyPreference={(teacherSite?.typographyPreference as 'modern' | 'classic') || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
      {/* Class toolbar (portals into the sidebar slot). The server-side
          isAuthor gate is gone with the session read, so it self-gates on the
          viewer's own site slug instead — the same ISR-friendly gate the
          [domain] routes use. It still self-gates on paid + has-classes. */}
      {skript.frontPage?.id && (
        <ClassToolbar
          pageId={skript.frontPage.id}
          pageType="standard"
          unlockedClasses={[]}
          requireOwnerSlug={teacherSite?.slug}
        />
      )}
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        {skript.frontPage?.content ? (
          <article className="prose-theme">
            <ServerMarkdownRenderer
              content={skript.frontPage.content}
              skriptId={skript.id}
              organizationSlug={orgSlug}
            />
          </article>
        ) : (
          <div className="text-center py-12">
            <h1 className="text-3xl font-bold mb-4">{skript.title}</h1>
            {skript.description && (
              <p className="text-muted-foreground mb-6">{skript.description}</p>
            )}
            {skript.pages.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Select a page from the sidebar to begin.
              </p>
            )}
          </div>
        )}
      </div>
    </PublicSiteLayout>
    </CurrentSiteProvider>
  )
}
