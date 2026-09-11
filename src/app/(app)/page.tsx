import { redirect } from 'next/navigation'

// This page is a fallback safety net.
// Normal traffic is handled by proxy.ts which routes:
// - Production: eduskript.org (custom domain) → /org/eduskript
// - Development: localhost → /org/eduskript
// If this page is somehow reached directly, redirect to the org page.
export default function HomePage() {
  redirect('/org/eduskript')
}
