'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Sign-in URL for public teacher/org pages, including custom-domain handling.
 *
 * Mirrors the logic in `src/components/public/auth-button.tsx` (kept as a
 * separate hook rather than refactoring that critical auth path). On a custom
 * domain, auth must happen on eduskript.org because the session cookie can't be
 * set cross-domain — so we route sign-in through the /api/auth/cross-domain
 * endpoint, which mints a one-time token and returns to `returnPath`.
 *
 * Caveat: without the teacher's real pageSlug (this hook only sees the URL), on
 * a custom domain the `from` param carries the first path segment (the skript
 * slug), which only affects the sign-in page's layout — the callbackUrl /
 * returnPath still bring the user back to the exact page.
 */
export function usePublicSignInUrl(): string {
  const pathname = usePathname() ?? '/'
  const pageSlug = pathname.split('/')[1] || undefined
  const isOrgPage = pathname.startsWith('/org/')
  const orgSlug = isOrgPage ? pathname.split('/')[2] : undefined

  const [url, setUrl] = useState(() => {
    const fromParam = isOrgPage && orgSlug
      ? `org/${orgSlug}`
      : pageSlug && !['auth', 'dashboard', 'api'].includes(pageSlug)
        ? pageSlug
        : undefined
    return fromParam
      ? `/auth/signin?from=${encodeURIComponent(fromParam)}&callbackUrl=${encodeURIComponent(pathname)}`
      : `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`
  })

  useEffect(() => {
    const hostname = window.location.hostname
    const knownHosts = ['localhost', 'eduskript.org', 'www.eduskript.org']
    const appHostname = process.env.NEXT_PUBLIC_APP_HOSTNAME
    if (appHostname && !knownHosts.includes(appHostname)) knownHosts.push(appHostname)
    const isCustomDomain = !knownHosts.includes(hostname)

    if (isCustomDomain && pageSlug) {
      const crossDomainCallback = `https://eduskript.org/api/auth/cross-domain?returnDomain=${encodeURIComponent(hostname)}&returnPath=${encodeURIComponent(pathname)}&from=${encodeURIComponent(pageSlug)}`
      // Client-only host check; the resulting one-shot setState is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(`https://eduskript.org/auth/signin?from=${encodeURIComponent(pageSlug)}&callbackUrl=${encodeURIComponent(crossDomainCallback)}`)
    }
  }, [pathname, pageSlug, isOrgPage, orgSlug])

  return url
}
