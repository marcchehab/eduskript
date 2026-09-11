import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

// TODO: Remove in spring 2026. Temporary legacy redirect for old URLs
// that included the collection slug prefix.
// /{domain}/{collectionSlug}/{skriptSlug}/{pageSlug} → /{domain}/{skriptSlug}/{pageSlug}

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

  // On custom domains the proxy already prepends the pageSlug, so redirect
  // without it to avoid a double prefix. The app's own hosts are the only ones
  // that route by path; keep them in sync with APP_DOMAINS in src/proxy.ts.
  // (Previously this tested `.eduskript.org`, a leftover from the abandoned
  // subdomain routing — it classified the apex eduskript.org as a custom domain
  // and dropped the teacher slug from the redirect.)
  const headersList = await headers()
  const hostname = (headersList.get('host') || '').split(':')[0]
  const APP_HOSTS = ['eduskript.org', 'www.eduskript.org', 'localhost']
  const isCustomDomain = !APP_HOSTS.includes(hostname)

  if (isCustomDomain) {
    redirect(`/${pageSlug}/${legacyPageSlug}`)
  } else {
    redirect(`/${domain}/${pageSlug}/${legacyPageSlug}`)
  }
}
