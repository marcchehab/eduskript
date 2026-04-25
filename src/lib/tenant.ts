/**
 * Per-tenant configuration for the multi-tenant SEO surface.
 *
 * Both eduskript.org and informatikgarten.ch are served by this same Next.js
 * app (proxy.ts rewrites to /org/{slug} or /{pageSlug} based on the host).
 * For SEO-critical signals like <html lang>, <title>, robots.txt, sitemap.xml,
 * and og:url we need to branch on the actual request host, not on the path
 * params (which contain the rewritten slug, not the public domain).
 */

import { headers } from 'next/headers'

export interface TenantConfig {
  /** The canonical public host (no scheme, no port). */
  host: string
  /** BCP-47 language tag for <html lang>. */
  lang: string
  /** Home-page <title> override (~50 chars, with target keyword). */
  homeTitle: string
}

const TENANTS: TenantConfig[] = [
  {
    host: 'informatikgarten.ch',
    lang: 'de-CH',
    homeTitle: 'Informatikgarten — Freies Lehrmittel für den Informatikunterricht',
  },
  {
    host: 'eduskript.org',
    lang: 'en',
    homeTitle: 'Eduskript — Open-Source Platform for Interactive Lessons',
  },
]

const DEFAULT_TENANT = TENANTS[TENANTS.length - 1]

/** Strip port and `www.` prefix from a host header value. */
function normalizeHost(host: string): string {
  const bare = host.split(':')[0].toLowerCase()
  return bare.startsWith('www.') ? bare.slice(4) : bare
}

/** Resolve the request host to a tenant config; falls back to eduskript.org. */
export function getTenantForHost(rawHost: string | null | undefined): TenantConfig {
  if (!rawHost) return DEFAULT_TENANT
  const host = normalizeHost(rawHost)
  return TENANTS.find(t => t.host === host) ?? DEFAULT_TENANT
}

/** Read the request host from headers (server components / route handlers only). */
export async function getRequestHost(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-host') || h.get('host') || ''
}

/** Resolve the current request to a tenant config. */
export async function getCurrentTenant(): Promise<TenantConfig> {
  return getTenantForHost(await getRequestHost())
}
