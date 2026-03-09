import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { recordMetric } from '@/lib/metrics/buffer'

// Cache entry types for domain lookups
type DomainCacheEntry =
  | { type: 'org'; orgSlug: string; expiry: number }
  | { type: 'teacher'; pageSlug: string; expiry: number }
  | null

// Simple in-memory cache for domain lookups (cleared on deploy/restart)
const domainCache = new Map<string, DomainCacheEntry>()
const negativeCacheExpiry = new Map<string, number>()
const CACHE_TTL = 60 * 1000 // 1 minute
const NEGATIVE_CACHE_TTL = 30 * 1000 // 30 seconds for "not found" results

// Default organization slug - all unknown domains fall back to this org
const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG || 'eduskript'

// Known domains that map directly to org slugs (no DB lookup needed)
const KNOWN_ORG_DOMAINS: Record<string, string> = {
  'eduskript.org': 'eduskript',
  'www.eduskript.org': 'eduskript',
}

// Known domains that map directly to teacher pageSlugs (no DB lookup needed)
const KNOWN_TEACHER_DOMAINS: Record<string, string> = {
  'informatikgarten.ch': 'ig',
  'www.informatikgarten.ch': 'ig',
}

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const { pathname } = request.nextUrl

  // Extract just the domain (without port for localhost)
  const domain = hostname.split(':')[0]

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

  // Skip for static files and internal routes
  if (
    isStaticOrInternal ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/org/') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/preview') ||
    pathname.startsWith('/exam-complete') ||
    pathname.startsWith('/impressum') ||
    pathname.startsWith('/terms')
  ) {
    return NextResponse.next()
  }

  // Check known domains first (no DB/API lookup needed)
  if (KNOWN_TEACHER_DOMAINS[domain]) {
    return rewriteToTeacher(request, KNOWN_TEACHER_DOMAINS[domain])
  }
  if (KNOWN_ORG_DOMAINS[domain]) {
    return rewriteToOrg(request, KNOWN_ORG_DOMAINS[domain])
  }

  // For localhost, check if it's a teacher pageSlug or fall back to default org
  if (domain === 'localhost') {
    return rewriteToOrg(request, DEFAULT_ORG_SLUG)
  }

  // Check cache first
  const cached = domainCache.get(domain)
  if (cached !== undefined) {
    if (cached === null) {
      // Negative cache hit (domain not found) - fall back to default org
      const expiry = negativeCacheExpiry.get(domain)
      if (expiry && expiry > Date.now()) {
        return rewriteToOrg(request, DEFAULT_ORG_SLUG)
      }
    } else if (cached.expiry > Date.now()) {
      // Positive cache hit
      if (cached.type === 'org') {
        return rewriteToOrg(request, cached.orgSlug)
      } else {
        return rewriteToTeacher(request, cached.pageSlug)
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
        return rewriteToTeacher(request, data.pageSlug)
      } else {
        // Cache org domain result (default behavior)
        domainCache.set(domain, {
          type: 'org',
          orgSlug: data.orgSlug,
          expiry: Date.now() + CACHE_TTL,
        })
        return rewriteToOrg(request, data.orgSlug)
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
  return rewriteToOrg(request, DEFAULT_ORG_SLUG)
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
