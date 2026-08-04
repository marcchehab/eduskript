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
import { revalidateTag, unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

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
 *
 * Tag-based and never time-expiring. It used to be `revalidate: 300`, which
 * looked harmless but was a steady wake-up call: robots.txt and sitemap.xml are
 * dynamic and crawlers hit them constantly, so with one entry per host the
 * cache expired roughly every 100 seconds across three hosts — and the managed
 * Postgres only sleeps after 5 uninterrupted minutes without a connection.
 * Query volume was never the issue; a fixed-interval lookup is the one shape
 * that reliably prevents sleep.
 *
 * A host's language changes only when someone edits it or re-points a domain,
 * so `invalidateTenantConfig()` is called from those writers instead.
 */
export const TENANT_CONFIG_TAG = 'tenant-config'

const lookupTenantLang = unstable_cache(
  async (host: string): Promise<string> => {
    // pageLanguage now lives on Site (org's Site, teacher's Site).
    const orgDomain = await prisma.customDomain.findFirst({
      where: { domain: host, isVerified: true },
      select: {
        organization: { select: { site: { select: { pageLanguage: true } } } },
      },
    })
    const orgLang = orgDomain?.organization?.site?.pageLanguage
    if (orgLang) return orgLang

    const teacherDomain = await prisma.teacherCustomDomain.findFirst({
      where: { domain: host, isVerified: true },
      select: {
        // The domain's own site, with the user's primary site as legacy fallback.
        site: { select: { pageLanguage: true } },
        user: { select: { sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { pageLanguage: true } } } },
      },
    })
    const teacherLang = teacherDomain?.site?.pageLanguage ?? teacherDomain?.user?.sites[0]?.pageLanguage
    if (teacherLang) return teacherLang

    return DEFAULT_LANG
  },
  ['tenant-lang-by-host'],
  { revalidate: false, tags: [TENANT_CONFIG_TAG] },
)

/** Drop the cached host→language mapping. */
export function invalidateTenantConfig(): void {
  revalidateTag(TENANT_CONFIG_TAG, { expire: 0 })
}

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
