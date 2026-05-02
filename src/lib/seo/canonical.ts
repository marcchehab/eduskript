/**
 * Canonical URL resolver.
 *
 * Multi-tenant Eduskript can serve the same content under several hosts
 * (`eduskript.org/<pageSlug>/...`, the proxy-rewritten `eduskript.org/...`
 * for the root org, plus any verified custom domain). Without a canonical
 * declaration, search engines split rank between those URLs.
 *
 * Resolution order:
 *   1. Primary verified custom domain, if present.
 *   2. Bare `eduskript.org` for the root `eduskript` org (special-cased
 *      because the proxy rewrites `/` → `/org/eduskript`).
 *   3. `eduskript.org/<slug>` for teachers, `eduskript.org/org/<slug>` for
 *      other orgs.
 *
 * The `path` argument is the public-facing subpath (already stripped of
 * any internal `/org/<slug>` proxy-rewrite prefix). Examples:
 *   - teacher home:    canonicalUrl({ type: 'teacher', slug: 'marc' })
 *   - teacher content: canonicalUrl({ type: 'teacher', slug: 'marc',
 *                                     path: '/cs101/intro' })
 *   - org home:        canonicalUrl({ type: 'org', slug: 'eduskript' })
 *   - org content:     canonicalUrl({ type: 'org', slug: 'eduskript',
 *                                     path: '/c/cs101/intro' })
 */

interface CanonicalArgs {
  type: 'teacher' | 'org'
  slug: string
  customDomains?: { domain: string }[] | null
  path?: string
}

export function canonicalUrl(args: CanonicalArgs): string {
  const path = args.path ?? ''
  const primaryDomain = args.customDomains?.[0]?.domain

  if (primaryDomain) {
    return `https://${primaryDomain}${path}`
  }

  if (args.type === 'org') {
    if (args.slug === 'eduskript') {
      return `https://eduskript.org${path}`
    }
    return `https://eduskript.org/org/${args.slug}${path}`
  }

  return `https://eduskript.org/${args.slug}${path}`
}

// Returns the URL object for the canonical's origin, suitable for
// `metadataBase` in Next.js generateMetadata. Anchoring metadataBase to the
// tenant's public host (custom domain when present, else eduskript.org) makes
// the file-based opengraph-image URL resolve to a host crawlers can actually
// reach — without this, Next.js falls back to the request host, which on
// Koyeb is the internal `http://localhost:8000`.
export function canonicalBase(args: Omit<CanonicalArgs, 'path'>): URL {
  return new URL(new URL(canonicalUrl(args)).origin)
}
