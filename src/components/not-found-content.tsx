import Link from 'next/link'

// Body of the tenant 404 boundaries (src/app/[domain]/not-found.tsx and
// src/app/org/[orgSlug]/not-found.tsx). Renders inside the tenant root
// layout, so fonts/theme come from RootShell.
export function NotFoundContent() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">This page could not be found.</p>
      <Link href="/" className="underline">
        Back to the start page
      </Link>
    </main>
  )
}
