import { RootShell, rootMetadata, rootViewport } from '@/components/root-shell'
import { getUiLocale } from '@/lib/i18n/server'
import { UiLocaleProvider } from '@/lib/i18n/client'

// Root layout for every non-tenant route (dashboard, auth, exam, legal, ...).
// Tenant routes have their own root layouts that SSR the tenant's language:
// src/app/[domain]/layout.tsx and src/app/org/[orgSlug]/layout.tsx.
// The UI language comes from the request (src/lib/i18n/locale.ts).
export const metadata = rootMetadata
export const viewport = rootViewport

export default async function AppRootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getUiLocale()
  return (
    <RootShell lang={locale}>
      <UiLocaleProvider locale={locale}>{children}</UiLocaleProvider>
    </RootShell>
  )
}
