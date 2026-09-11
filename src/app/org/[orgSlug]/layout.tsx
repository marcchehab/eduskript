import { RootShell, rootMetadata, rootViewport } from '@/components/root-shell'
import { getOrgPageLanguage } from '@/lib/cached-queries'

// Root layout (renders <html>/<body> via RootShell) for every
// /org/[orgSlug]/... route. Its only job is SSR-ing the org's pageLanguage
// into <html lang>. Reads params + a cached query only (no headers()), so
// the ISR'd child pages stay static.
//
// Cached read tagged CACHE_TAGS.organization(slug); the org settings PATCH
// busts that tag, and its revalidatePath('/org/<slug>', 'layout') cascades
// through here into the child routes.
export const metadata = rootMetadata
export const viewport = rootViewport

export default async function OrgLayout({
  params,
  children,
}: {
  params: Promise<{ orgSlug: string }>
  children: React.ReactNode
}) {
  const { orgSlug } = await params
  const pageLanguage = await getOrgPageLanguage(orgSlug)
  return <RootShell lang={pageLanguage}>{children}</RootShell>
}
