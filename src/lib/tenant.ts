/**
 * Per-tenant configuration for the multi-tenant SEO surface.
 *
 * Hardcoding policy: only the canonical app host (eduskript.org) lives in
 * code. Every other tenant — teacher custom domains, org custom domains —
 * resolves through the database (TeacherCustomDomain / CustomDomain) so
 * that adding a new teacher's domain never requires a code change.
 *
 * This module powers SEO signals that need a per-host answer before any
 * route param is known: <html lang> in the root layout, robots.txt, and
 * sitemap.xml. The home <title> override is computed in the page-level
 * generateMetadata using teacher/org data already loaded for that route.
 */

import { headers } from 'next/headers'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

export interface TenantInfo {
  /** Canonical public host (no scheme, no port, no www. prefix). */
  host: string
  /** BCP-47 language tag for <html lang>. Defaults to "en". */
  lang: string
}

const ROOT_HOST = 'eduskript.org'
const ROOT_HOSTS = new Set<string>([ROOT_HOST, 'localhost'])
const DEFAULT_LANG = 'en'

const ROOT_TENANT: TenantInfo = { host: ROOT_HOST, lang: DEFAULT_LANG }

/** Strip port and `www.` prefix from a host header value. */
function normalizeHost(host: string): string {
  const bare = host.split(':')[0].toLowerCase()
  return bare.startsWith('www.') ? bare.slice(4) : bare
}

/** Read the request host from headers (server components / route handlers only). */
export async function getRequestHost(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-host') || h.get('host') || ''
}

/**
 * Resolve a custom-domain host to its configured language.
 * Cached so the root layout's per-request lookup doesn't hit the DB on
 * every page load. Cache busts after 5 minutes; explicit invalidation can
 * be added via the `tenant-config` tag if dashboard edits need to be
 * reflected immediately.
 */
const lookupTenantLang = unstable_cache(
  async (host: string): Promise<string> => {
    const orgDomain = await prisma.customDomain.findFirst({
      where: { domain: host, isVerified: true },
      select: { organization: { select: { pageLanguage: true } } },
    })
    if (orgDomain?.organization?.pageLanguage) {
      return orgDomain.organization.pageLanguage
    }

    const teacherDomain = await prisma.teacherCustomDomain.findFirst({
      where: { domain: host, isVerified: true },
      select: { user: { select: { pageLanguage: true } } },
    })
    if (teacherDomain?.user?.pageLanguage) {
      return teacherDomain.user.pageLanguage
    }

    return DEFAULT_LANG
  },
  ['tenant-lang-by-host'],
  { revalidate: 300, tags: ['tenant-config'] },
)

/** Resolve the current request's canonical host and language. */
export async function getCurrentTenant(): Promise<TenantInfo> {
  const host = normalizeHost(await getRequestHost())
  if (!host || ROOT_HOSTS.has(host)) return ROOT_TENANT

  const lang = await lookupTenantLang(host).catch(err => {
    console.error('tenant: lang lookup failed for', host, err)
    return DEFAULT_LANG
  })
  return { host, lang }
}

/**
 * True when the request host is a tenant's canonical domain (anything
 * other than the root app host or localhost). Used by page metadata to
 * decide whether to apply SEO-tuned home titles.
 */
export function isCustomTenantHost(host: string): boolean {
  const normalized = normalizeHost(host)
  return Boolean(normalized) && !ROOT_HOSTS.has(normalized)
}
