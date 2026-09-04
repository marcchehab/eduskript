import { notFound } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import { HtmlLangSetter } from '@/components/seo/html-lang-setter'
import { CurrentSiteProvider } from '@/contexts/current-site-context'
import { getTeacherWithLayout } from '@/lib/cached-queries'
import { getTeacherSidebarData } from '@/lib/sidebar-items'

// Shared sidebar shell for every public tenant route. Living at the [domain]
// boundary means the sidebar client component stays mounted across ALL
// navigation under /[domain]/... — page-to-page, skript-to-skript, and back
// to the domain root — so expansion state and scroll position never reset.
//
// Both sidebar modes route through here:
//   - full: siteStructure renders as-is (every collection/skript/page).
//   - contextual: PublicSiteLayout filters to the current skript via
//     useParams() on the client.
//
// Only published content is reachable at public URLs; authors view drafts
// via the editor's built-in live preview. fullSiteStructure is published-only.

interface DomainLayoutProps {
  params: Promise<{ domain: string }>
  children: React.ReactNode
}

const INVALID_DOMAIN_PREFIXES = ['.well-known', '_next', 'api', 'favicon', 'robots', 'sitemap', 'apple-touch-icon', 'manifest']

export default async function DomainLayout({ params, children }: DomainLayoutProps) {
  const { domain } = await params

  if (INVALID_DOMAIN_PREFIXES.some(invalid => domain.startsWith(invalid) || domain.includes('.'))) {
    notFound()
  }

  const teacher = await getTeacherWithLayout(domain)
  if (!teacher) notFound()

  // Interleaved collections + root skripts in exact page-builder order.
  // Shared with the org routes (src/lib/sidebar-items.ts) so eduskript.org
  // and custom-domain sidebars render identically. Treat an empty/null
  // sidebarBehavior as full (matches the Prisma default and the fallback
  // passed to PublicSiteLayout below).
  const effectiveSidebarBehavior = teacher.sidebarBehavior || 'full'
  const { sidebarItems, fullSiteStructure, rootSkripts } =
    await getTeacherSidebarData(teacher.id, domain)

  const teacherForLayout = {
    name: teacher.name || teacher.pageSlug || 'Unknown',
    pageSlug: teacher.pageSlug || domain,
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
    titleStyle: teacher.titleStyle || null,
    logoUrl: teacher.logoUrl || null,
    bio: teacher.bio || null,
    title: teacher.title || null,
    billingPlan: teacher.billingPlan,
    supporterBadgeHidden: teacher.supporterBadgeHidden ?? false,
    supporterBadgeMessage: teacher.supporterBadgeMessage ?? null,
  }

  return (
    <CurrentSiteProvider siteId={teacher.siteId}>
      <HtmlLangSetter lang={teacher.pageLanguage} />
      <PublicSiteLayout
        teacher={teacherForLayout}
        siteStructure={fullSiteStructure}
        rootSkripts={rootSkripts}
        sidebarItems={sidebarItems}
        sidebarBehavior={effectiveSidebarBehavior as 'contextual' | 'full'}
        typographyPreference={(teacher.typographyPreference as 'modern' | 'classic') || 'modern'}
      >
        {children}
      </PublicSiteLayout>
    </CurrentSiteProvider>
  )
}
