import type { Metadata } from 'next'
import { LockdownRequiredPage } from '@/components/public/lockdown-required-page'

export const metadata: Metadata = {
  title: 'Safe Exam Browser Required',
  robots: { index: false, follow: false },
}

// Reached only via the middleware lockdown rewrite (src/proxy.ts). `from` is the
// same-site path the student was on, so SEB can reopen exactly there.
export default async function SebRequiredPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : '/'
  return <LockdownRequiredPage from={safeFrom} />
}
