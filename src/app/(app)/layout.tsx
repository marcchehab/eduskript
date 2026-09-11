import { RootShell, rootMetadata, rootViewport } from '@/components/root-shell'

// Root layout for every non-tenant route (dashboard, auth, exam, legal, ...).
// Tenant routes have their own root layouts that SSR the tenant's language:
// src/app/[domain]/layout.tsx and src/app/org/[orgSlug]/layout.tsx.
export const metadata = rootMetadata
export const viewport = rootViewport

export default function AppRootLayout({ children }: { children: React.ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>
}
