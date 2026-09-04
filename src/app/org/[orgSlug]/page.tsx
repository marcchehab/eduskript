import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { PublicSiteLayout } from '@/components/public/layout'
import { ServerMarkdownRenderer } from '@/components/markdown/markdown-renderer.server'
import { AnnotationWrapper } from '@/components/public/annotation-wrapper'
import { ClassToolbar } from '@/components/teacher/class-toolbar'
import { HtmlLangSetter } from '@/components/seo/html-lang-setter'
import { getOrgWithLayout, getOrgHomepageContent } from '@/lib/cached-queries'
import { getOrgSidebarData } from '@/lib/sidebar-items'
import { CurrentSiteProvider } from '@/contexts/current-site-context'
import { prisma } from '@/lib/prisma'
import { canonicalUrl, canonicalBase } from '@/lib/seo/canonical'
import { JsonLd, organizationSchema } from '@/lib/seo/json-ld'
import { getPublicLayers, EMPTY_PUBLIC_LAYERS } from '@/lib/public-page-data'

// ISR: published content only and no session read, so every visitor gets the
// same HTML. Next.js 16 needs generateStaticParams() — even empty — or a
// dynamic route stays dynamic.
export const revalidate = false
export const dynamicParams = true
export async function generateStaticParams() {
  return []
}

interface OrgPageProps {
  params: Promise<{
    orgSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: OrgPageProps): Promise<Metadata> {
  const { orgSlug } = await params

  try {
    const site = await prisma.site.findUnique({
      where: { slug: orgSlug },
      select: {
        // Page-display fields live on Site now; org keeps only the entity
        // fields (name, customDomains).
        pageDescription: true,
        pageIcon: true,
        pageTagline: true,
        showIcon: true,
        organization: {
          select: {
            name: true,
            customDomains: {
              where: { isVerified: true, isPrimary: true },
              select: { domain: true },
              take: 1,
            },
          }
        }
      },
    })
    const organization = site?.organization
      ? {
          ...site.organization,
          description: site.pageDescription,
          iconUrl: site.pageIcon,
          pageTagline: site.pageTagline,
          showIcon: site.showIcon,
        }
      : null

    if (!organization) {
      return {
        title: 'Organization Not Found',
        description: 'The requested organization could not be found.',
      }
    }

    // ISR-safe canonical: prefer the org's primary verified custom domain;
    // fall back to eduskript.org (root org) or eduskript.org/org/<orgSlug>.
    const primaryDomain = organization.customDomains?.[0]?.domain
    const canonical = canonicalUrl({
      type: 'org',
      slug: orgSlug,
      customDomains: organization.customDomains,
    })

    // SEO-tuned title source order:
    //   1. Tenant on a custom domain with a configured pageTagline.
    //   2. The canonical app org (eduskript) — hardcoded once here per the
    //      "only eduskript.org may be hardcoded" rule.
    //   3. Plain org name.
    const title = primaryDomain && organization.pageTagline
      ? `${organization.name} — ${organization.pageTagline}`
      : orgSlug === 'eduskript'
        ? 'Eduskript — Open-Source Platform for Interactive Lessons'
        : organization.name
    const description = organization.description || `${organization.name} on Eduskript`

    // og:image: explicit URL from canonical so custom-domain orgs don't ship
    // the proxy-prepended `/org/<orgSlug>/` prefix that Next's auto-detected
    // URL would include (and which 404s for external crawlers).
    const ogImage = `${canonical}/opengraph-image`
    return {
      metadataBase: canonicalBase({
        type: 'org',
        slug: orgSlug,
        customDomains: organization.customDomains,
      }),
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        type: 'website',
        siteName: organization.name,
        url: canonical,
        images: [ogImage],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImage],
      },
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Eduskript',
      description: 'Educational content platform',
    }
  }
}

export default async function OrgPage({ params }: OrgPageProps) {
  const { orgSlug } = await params

  // Get organization with layout using cached query
  const organization = await getOrgWithLayout(orgSlug)

  if (!organization) {
    notFound()
  }

  // No session read: this route is ISR-cached and must render the same HTML
  // for every visitor. It previously read the session (plus an org-membership
  // query) so admins could preview an unpublished frontpage in place, which
  // made every request — crawlers included — a dynamic render. Admins preview
  // from /dashboard/org/<id>/frontpage instead.
  const frontPage = organization.frontPage
  const showFrontPage = frontPage && frontPage.isPublished

  // Fetch public annotations, snaps, and sticky notes for this front page
  const { publicAnnotations, publicSnaps, publicStickyNotes } = frontPage
    ? await getPublicLayers(frontPage.id)
    : EMPTY_PUBLIC_LAYERS

  // Authorship for the annotation toolbar is resolved client-side inside
  // AnnotationLayer, so nothing per-visitor reaches the cached HTML.

  // Get page layout items
  const pageItems = organization.pageLayout?.items || []

  // Fetch homepage content using cached query
  const { collections, rootSkripts } = pageItems.length > 0
    ? await getOrgHomepageContent(
        organization.id,
        orgSlug,
        pageItems.map(item => ({ type: item.type, contentId: item.contentId }))
      )
    : { collections: [], rootSkripts: [] }

  // Create a "teacher" object for PublicSiteLayout (org acts as page owner)
  // For pageIcon: if showIcon is false, use null; if showIcon is true but no custom iconUrl,
  // we'll rely on the OrgIcon component to show the default NotebookPen icon
  const orgAsTeacher = {
    name: organization.name,
    pageSlug: `org/${orgSlug}`, // Used for localStorage keys
    pageName: organization.name,
    pageDescription: organization.description,
    pageIcon: organization.showIcon ? (organization.iconUrl || 'default') : null,
    titleStyle: organization.titleStyle,
    logoUrl: organization.logoUrl,
    bio: null,
    title: null
  }

  // Full mode: interleaved page-builder sidebar (collections + root skripts),
  // shared with the /c/ content routes via src/lib/sidebar-items.ts.
  const sidebarData = organization.sidebarBehavior === 'full'
    ? await getOrgSidebarData(organization.id, orgSlug)
    : undefined

  return (
    <CurrentSiteProvider siteId={organization.siteId} organizationId={organization.id}>
      <HtmlLangSetter lang={organization.pageLanguage} />
      {orgSlug === 'eduskript' && <JsonLd schema={organizationSchema()} />}
    <PublicSiteLayout
      teacher={orgAsTeacher}
      siteStructure={collections}
      rootSkripts={rootSkripts}
      sidebarItems={sidebarData?.sidebarItems}
      fullSiteStructure={sidebarData?.fullSiteStructure}
      sidebarBehavior={organization.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference="modern"
      routePrefix={`/org/${orgSlug}/c`}
      homeUrl={`/org/${orgSlug}`}
      pageId={frontPage?.id}
    >
      {/* Class toolbar (portals into the sidebar slot). The server-side isAdmin
          gate went with the session read, so it self-gates client-side on page
          authorship — the same mechanism the ISR org /c/ content route uses.
          It still self-gates on paid + has-classes. */}
      {frontPage?.id && (
        <ClassToolbar
          pageId={frontPage.id}
          pageType="standard"
          unlockedClasses={[]}
          gateOnPageAuthor
        />
      )}
      <div id="paper" className="paper-responsive py-24 bg-card paper-shadow border border-border">
        {/* Frontpage content or empty state for admins */}
        {showFrontPage && frontPage.content ? (
          <article className="prose-theme">
            <AnnotationWrapper pageId={frontPage.id} content={frontPage.content} publicAnnotations={publicAnnotations} publicSnaps={publicSnaps} publicStickyNotes={publicStickyNotes}>
              <ServerMarkdownRenderer
                content={frontPage.content}
                pageId={frontPage.id}
                skriptId={frontPage.fileSkriptId || undefined}
                organizationSlug={orgSlug}
                pageLanguage={organization.pageLanguage}
              />
            </AnnotationWrapper>
          </article>
        ) : (
          <div className="text-center py-12">
            {/* No owner CTA here: gating it client-side would need an
                org-membership lookup, and admins create the frontpage from
                /dashboard/org/<id>/frontpage anyway. */}
            <h1 className="text-3xl font-bold mb-4">
              Welcome to {organization.name}
            </h1>
            <p className="text-muted-foreground">
              This organization is setting up their page. Check back soon!
            </p>
          </div>
        )}
      </div>
    </PublicSiteLayout>
    </CurrentSiteProvider>
  )
}
