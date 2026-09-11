import { HtmlLangSetter } from '@/components/seo/html-lang-setter'
import { getOrgPageLanguage } from '@/lib/cached-queries'

// Shared shell for every /org/[orgSlug]/... route. Its only job is the
// per-org <html lang> override (the root layout SSRs lang="en" for ISR
// reasons, see src/app/layout.tsx). Before this layout existed only the org
// frontpage set lang; /c/ skript and content pages stayed "en".
//
// Cached read tagged CACHE_TAGS.organization(slug); the org settings PATCH
// busts that tag, and its revalidatePath('/org/<slug>', 'layout') now
// cascades through here into the child routes.
export default async function OrgLayout({
  params,
  children,
}: {
  params: Promise<{ orgSlug: string }>
  children: React.ReactNode
}) {
  const { orgSlug } = await params
  const pageLanguage = await getOrgPageLanguage(orgSlug)
  return (
    <>
      <HtmlLangSetter lang={pageLanguage} />
      {children}
    </>
  )
}
