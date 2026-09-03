import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { recordMetric, recordPathHit, drainForShipping } from '@/lib/metrics/buffer'
import { isSEBRequest } from '@/lib/seb'
import { DEMO_EMAIL } from '@/lib/demo-account'

// Cache entry types for domain lookups
type DomainCacheEntry =
  | { type: 'org'; orgSlug: string; expiry: number }
  | { type: 'teacher'; pageSlug: string; expiry: number }
  | null

// Simple in-memory cache for domain lookups (cleared on deploy/restart)
const domainCache = new Map<string, DomainCacheEntry>()
const negativeCacheExpiry = new Map<string, number>()
// Domain→site mappings change when someone configures a custom domain, which
// is a deliberate, rare act. A 60s TTL meant steady traffic to one custom
// domain cost up to 2 queries every minute (resolve-domain does two lookups)
// — enough on its own to keep the managed Postgres from ever suspending, and
// it bills compute-hours. Negative results stay short so a domain that was
// just pointed at us starts working promptly.
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const NEGATIVE_CACHE_TTL = 30 * 1000 // 30 seconds for "not found" results

// Default organization slug - all unknown domains fall back to this org
const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG || 'eduskript'

// The app's own hostnames — hardcoded so the site can't be taken
// offline by a bad DB row. Every other custom domain (teacher or org)
// is resolved via the DB through /api/internal/resolve-domain.
const APP_DOMAINS: Record<string, string> = {
  'eduskript.org': 'eduskript',
  'www.eduskript.org': 'eduskript',
}

// Settings the public demo account may not touch. Anything that would outlive
// the nightly reset (src/lib/seed-demo-content.ts) or break the demo URL until
// it runs: the site slug, custom domains, account credentials, MCP tokens,
// billing. Content routes stay writable — editing pages is the demo.
//
// A prefix list, so a settings route added outside these paths is not covered.
// Checked here rather than per-route because the alternative is a guard in
// ~20 handlers under /api/user alone.
const DEMO_LOCKED_PREFIXES = [
  '/api/user/',
  '/api/sites',
  '/api/subscriptions',
  '/api/mcp/',
  '/api/organizations',
  '/api/admin/',
]

/** 403 for a write the demo account is not allowed to make, else null. */
async function demoWriteGuard(request: NextRequest, pathname: string) {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  if (!DEMO_LOCKED_PREFIXES.some(p => pathname.startsWith(p))) return null

  const { getToken } = await import('next-auth/jwt')
  const token = await getToken({ req: request })
  if (token?.email !== DEMO_EMAIL) return null

  return NextResponse.json(
    { error: 'The demo account cannot change settings. Create a free account to try this.' },
    { status: 403 }
  )
}

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const { pathname } = request.nextUrl

  // Before the /api early return below — API routes are matched by the config
  // at the bottom of this file, they just fall straight through otherwise.
  const denied = await demoWriteGuard(request, pathname)
  if (denied) return denied

  // Extract just the domain (without port for localhost)
  const domain = hostname.split(':')[0]

  // First path segment doubles as the teacher/org pageSlug on org + localhost
  // routes (eduskript.org/<slug>/...). Used by the lockdown gate below. On
  // teacher custom domains the slug instead comes from domain resolution.
  const firstSegment = pathname.split('/')[1] || ''

  // Track page loads - must happen BEFORE early returns
  // 1. Hard navigation: Sec-Fetch-Mode: navigate (direct URL, refresh)
  // 2. SPA navigation: Next-Url header present (client-side nav destination)
  const secFetchMode = request.headers.get('Sec-Fetch-Mode')
  const nextUrl = request.headers.get('Next-Url')
  const prefetchHeader = request.headers.get('Next-Router-Prefetch')

  const isStaticOrInternal = pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.includes('.')

  const isHardNavigation = secFetchMode === 'navigate' && !isStaticOrInternal
  const isSpaNavigation = nextUrl !== null && prefetchHeader !== '1'

  if (isHardNavigation || isSpaNavigation) {
    recordMetric('page_loads_total', 1)
  }

  // Which URLs are worth pre-rendering after a deploy (src/lib/cache-warmer.ts).
  // Counted here because this is the only place that sees every request — an ISR
  // cache hit never reaches the page component — and deliberately NOT gated on
  // the navigation check above: crawlers send no Sec-Fetch-Mode, and crawler
  // traffic is precisely what pays for a cold cache. page_loads_total keeps that
  // gate because it is meant to count humans. Keyed by host so tenants stay
  // separate; MAX_TRACKED_PATHS bounds the cardinality.
  if (!isStaticOrInternal) {
    recordPathHit(`${domain}${pathname}`)
  }

  // Hand the buffer to the app runtime, which has DB access. Fire-and-forget
  // and rate-limited internally, so it adds nothing to this request's latency.
  shipMetricsIfDue()

  // Skip for static files and internal routes
  if (
    isStaticOrInternal ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/oauth/') ||
    pathname.startsWith('/org/') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/embed/') ||
    pathname.startsWith('/exam/') ||
    pathname.startsWith('/exam-complete') ||
    pathname.startsWith('/seb-required') ||
    pathname.startsWith('/impressum') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/supporters')
  ) {
    return NextResponse.next()
  }

  // Short-circuit for the app's own hostnames (no DB/API lookup needed)
  if (APP_DOMAINS[domain]) {
    return gatedOrg(request, APP_DOMAINS[domain], firstSegment)
  }

  // For localhost: rewrite root and the org-content prefix /c/* to the
  // default org, otherwise let /<teacher-slug>/... fall through to the
  // [domain] route directly. On a real custom host /c/* gets rewritten
  // for free; localhost has no host to disambiguate so we treat the
  // /c/ prefix as the explicit "this is the default org's content" signal.
  if (domain === 'localhost') {
    if (pathname === '/' || pathname === '/c' || pathname.startsWith('/c/')) {
      return rewriteToOrg(request, DEFAULT_ORG_SLUG)
    }
    // Teacher page on localhost: /<pageSlug>/... falls through to the [domain]
    // route. Run the lockdown gate using the first path segment as the slug.
    const gated = await maybeRewriteForLockdown(request, firstSegment)
    return gated ?? NextResponse.next()
  }

  // Check cache first
  const cached = domainCache.get(domain)
  if (cached !== undefined) {
    if (cached === null) {
      // Negative cache hit (domain not found) - fall back to default org
      const expiry = negativeCacheExpiry.get(domain)
      if (expiry && expiry > Date.now()) {
        return gatedOrg(request, DEFAULT_ORG_SLUG, firstSegment)
      }
    } else if (cached.expiry > Date.now()) {
      // Positive cache hit
      if (cached.type === 'org') {
        return gatedOrg(request, cached.orgSlug, firstSegment)
      } else {
        return gatedTeacher(request, cached.pageSlug)
      }
    }
  }

  // Look up domain in database via internal API
  // Use HTTP for internal calls to avoid SSL issues on container platforms
  try {
    const port = process.env.PORT || '3000'
    const resolveUrl = new URL(`http://localhost:${port}/api/internal/resolve-domain`)
    resolveUrl.searchParams.set('domain', domain)

    const response = await fetch(resolveUrl.toString(), {
      headers: {
        // Forward cookies for auth if needed
        cookie: request.headers.get('cookie') || '',
      },
    })

    if (response.ok) {
      const data = await response.json()

      if (data.type === 'teacher') {
        // Cache teacher domain result
        domainCache.set(domain, {
          type: 'teacher',
          pageSlug: data.pageSlug,
          expiry: Date.now() + CACHE_TTL,
        })
        return gatedTeacher(request, data.pageSlug)
      } else {
        // Cache org domain result (default behavior)
        domainCache.set(domain, {
          type: 'org',
          orgSlug: data.orgSlug,
          expiry: Date.now() + CACHE_TTL,
        })
        return gatedOrg(request, data.orgSlug, firstSegment)
      }
    } else {
      // Domain not found - negative cache
      domainCache.set(domain, null)
      negativeCacheExpiry.set(domain, Date.now() + NEGATIVE_CACHE_TTL)
    }
  } catch (error) {
    console.error('Domain resolution error:', error)
    // Don't cache errors
  }

  // Domain not found in database - fall back to default org
  return gatedOrg(request, DEFAULT_ORG_SLUG, firstSegment)
}

/**
 * Anti-distraction lockdown gate (NOT security). When a logged-in student belongs
 * to a lockdown class of `pageSlug`'s teacher and isn't in Safe Exam Browser, send
 * them to the SEB-required screen instead of the page. Returns a rewrite to gate,
 * or null to pass.
 *
 * Skips entirely (no DB hit, no fetch) for: SEB requests, router prefetches, empty
 * slugs, and anonymous visitors (no session cookie). That keeps public-page ISR/SEO
 * for crawlers and logged-out visitors completely untouched — only logged-in,
 * non-SEB navigations pay for one internal lookup.
 */
async function maybeRewriteForLockdown(
  request: NextRequest,
  pageSlug: string
): Promise<NextResponse | null> {
  if (!pageSlug) return null
  // SEB users always pass — that's the whole point.
  if (isSEBRequest(request.headers)) return null
  // Don't gate router prefetches; only real navigations.
  if (request.headers.get('Next-Router-Prefetch') === '1') return null
  // No NextAuth session cookie → anonymous → pass without touching the DB.
  // Dev uses `next-auth.session-token`; prod prefixes `__Secure-`, which still
  // contains the same substring, so one check covers both.
  const cookieHeader = request.headers.get('cookie') || ''
  if (!cookieHeader.includes('next-auth.session-token=')) return null

  try {
    const port = process.env.PORT || '3000'
    const checkUrl = new URL(`http://localhost:${port}/api/internal/check-lockdown`)
    checkUrl.searchParams.set('pageSlug', pageSlug)
    const res = await fetch(checkUrl.toString(), {
      headers: { cookie: request.headers.get('cookie') || '' },
    })
    if (!res.ok) return null
    const { locked } = await res.json()
    if (!locked) return null

    // Rewrite to the SEB-required screen, preserving the URL the student was on so
    // the screen can offer to reopen exactly here inside SEB.
    const from = request.nextUrl.pathname + request.nextUrl.search
    const url = request.nextUrl.clone()
    url.pathname = '/seb-required'
    url.search = ''
    url.searchParams.set('from', from)
    return NextResponse.rewrite(url)
  } catch (error) {
    console.error('Lockdown check error:', error)
    return null // fail open — anti-distraction must never lock the site on errors
  }
}

// Gate-then-rewrite wrappers used at every teacher/org terminal branch.
async function gatedTeacher(request: NextRequest, pageSlug: string) {
  const gated = await maybeRewriteForLockdown(request, pageSlug)
  return gated ?? rewriteToTeacher(request, pageSlug)
}

async function gatedOrg(request: NextRequest, orgSlug: string, slug: string) {
  const gated = await maybeRewriteForLockdown(request, slug)
  return gated ?? rewriteToOrg(request, orgSlug)
}

function rewriteToOrg(request: NextRequest, orgSlug: string) {
  const url = request.nextUrl.clone()
  const path = url.pathname

  // Rewrite to /org/[slug] path
  // / -> /org/eduskript
  // /about -> /org/eduskript/about (if sub-pages exist in future)
  url.pathname = `/org/${orgSlug}${path === '/' ? '' : path}`

  return NextResponse.rewrite(url)
}

function rewriteToTeacher(request: NextRequest, pageSlug: string) {
  const url = request.nextUrl.clone()
  const path = url.pathname

  // Rewrite to /[pageSlug] path (teacher's personal page)
  // / -> /teacher-name
  // /about -> /teacher-name/about
  url.pathname = `/${pageSlug}${path === '/' ? '' : path}`

  return NextResponse.rewrite(url)
}

// How often the proxy hands its counters to the app runtime. Not a DB write —
// just an internal HTTP call — so the interval is about keeping the payload
// small, not about waking the database.
const SHIP_INTERVAL_MS = 60 * 1000
let lastShippedAt = 0

function shipMetricsIfDue(): void {
  if (Date.now() - lastShippedAt < SHIP_INTERVAL_MS) return
  lastShippedAt = Date.now()

  const payload = drainForShipping()
  if (payload.metrics.length === 0 && payload.paths.length === 0) return

  const port = process.env.PORT || '3000'
  try {
    // Promise.resolve() because this runs in the request path and must never
    // throw: a stubbed fetch (tests) can return undefined, and a synchronous
    // throw here would take the request down with it.
    void Promise.resolve(
      fetch(`http://localhost:${port}/api/internal/metrics-ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    ).catch(() => {
      // The counters are already drained; losing a window of metrics is not
      // worth retry machinery in the request path.
    })
  } catch {
    // Same reasoning: metrics must not be able to break routing.
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/internal).*)',
  ],
}
