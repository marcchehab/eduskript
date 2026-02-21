import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

// Legacy redirect: /{domain}/{collectionSlug}/{skriptSlug}/{pageSlug}
// → /{domain}/{skriptSlug}/{pageSlug}
// Handles old URLs that included the collection slug prefix.

interface LegacyPageProps {
  params: Promise<{
    domain: string
    skriptSlug: string // actually the old collection slug (ignored)
    pageSlug: string // actually the skript slug
    legacyPageSlug: string // actually the page slug
  }>
}

export default async function LegacyRedirectPage({ params }: LegacyPageProps) {
  const { domain, pageSlug, legacyPageSlug } = await params

  // On custom domains the proxy already prepends the pageSlug,
  // so redirect without it to avoid a double prefix.
  const headersList = await headers()
  const hostname = (headersList.get('host') || '').split(':')[0]
  const isCustomDomain = !hostname.endsWith('.eduskript.org') && hostname !== 'localhost'

  if (isCustomDomain) {
    redirect(`/${pageSlug}/${legacyPageSlug}`)
  } else {
    redirect(`/${domain}/${pageSlug}/${legacyPageSlug}`)
  }
}
