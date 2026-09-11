import { RootShell, rootMetadata, rootViewport } from '@/components/root-shell'
import { getTeacherWithLayout } from '@/lib/cached-queries'

// Root layout for every custom-domain tenant route: renders <html>/<body>
// via RootShell with the tenant's pageLanguage SSR'd into <html lang>.
// Reads params + the unstable_cache'd teacher lookup only (no headers()),
// so ISR on the pages below is unaffected. Never throws: unknown slugs fall
// through with lang="en" and the nested (site)/layout.tsx calls notFound(),
// which ./not-found.tsx renders inside this shell with a 404 status.
export const metadata = rootMetadata
export const viewport = rootViewport

export default async function DomainRootLayout({
  params,
  children,
}: {
  params: Promise<{ domain: string }>
  children: React.ReactNode
}) {
  const { domain } = await params
  // Same cached read as (site)/layout.tsx — one DB hit per revalidation, not two.
  const teacher = domain.includes('.') ? null : await getTeacherWithLayout(domain)
  return <RootShell lang={teacher?.pageLanguage}>{children}</RootShell>
}
