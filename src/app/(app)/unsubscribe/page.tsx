import type { Metadata } from 'next'
import { verifyUserToken } from '@/lib/product-updates/tokens'
import { ProductUpdatesTokenAction, InvalidProductUpdatesLink } from '@/components/product-updates/token-action'

// Linked from product-update mails (src/lib/product-updates/). No login.
// Showing the page changes nothing; the button POSTs to /api/product-updates/unsubscribe.
export const metadata: Metadata = { title: 'Product updates', robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  if (!token || !verifyUserToken('unsubscribe', token)) return <InvalidProductUpdatesLink />
  return <ProductUpdatesTokenAction action="unsubscribe" token={token} />
}
