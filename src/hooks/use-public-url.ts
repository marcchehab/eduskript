'use client'

import { useMemo } from 'react'
import { isCustomDomainServer } from '@/lib/custom-domain'

/**
 * Builds public-facing URLs, accounting for custom domains.
 *
 * On custom domains (e.g. informatikgarten.ch), the proxy prepends the
 * owner's pageSlug, so we must omit it from the URL path.
 * On the canonical host (eduskript.org), the pageSlug is needed as the
 * first path segment.
 *
 * There is no "preview URL" — unpublished content is not viewable via URL.
 * Authors use the editor's built-in live preview to see drafts.
 *
 * The `ownerPageSlug` argument must be the page owner's slug, NOT the
 * current session user's slug. On co-authored content those differ.
 */
export function usePublicUrl(ownerPageSlug: string | undefined) {
  const isCustomDomain = useMemo(() => {
    if (typeof window === 'undefined') return false
    return isCustomDomainServer(window.location.hostname)
  }, [])

  /** Build a public page URL: /{skript}/{page} on a custom domain, /{owner}/{skript}/{page} on the canonical host. */
  function buildPageUrl(skriptSlug: string, pageSlug: string) {
    if (isCustomDomain) {
      return `/${skriptSlug}/${pageSlug}`
    }
    return `/${ownerPageSlug}/${skriptSlug}/${pageSlug}`
  }

  return { buildPageUrl, isCustomDomain }
}
