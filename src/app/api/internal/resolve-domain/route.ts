import { NextRequest, NextResponse } from 'next/server'
import { resolveCustomDomain } from '@/lib/cached-queries'

// GET - Resolve a custom domain to organization or teacher
// This is an internal API used by middleware for domain resolution
// Returns either:
//   { type: 'org', orgId, orgSlug, orgName, isPrimary }
//   { type: 'teacher', userId, pageSlug, userName, isPrimary }
//
// The lookup lives in resolveCustomDomain() so it can be cached and tagged per
// domain: the proxy's in-process map expires every 15 minutes (src/proxy.ts),
// and two uncached Prisma queries per expiry were enough to keep the managed
// Postgres awake — it sleeps only after 5 minutes without a connection.
// Invalidation is explicit, via invalidateDomainCache().
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const domain = searchParams.get('domain')

    if (!domain) {
      return NextResponse.json({ error: 'Domain parameter required' }, { status: 400 })
    }

    const normalizedDomain = domain.toLowerCase().trim()
    const resolved = await resolveCustomDomain(normalizedDomain)

    if (!resolved) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    return NextResponse.json(resolved)
  } catch (error) {
    console.error('Error resolving domain:', error)
    return NextResponse.json({ error: 'Failed to resolve domain' }, { status: 500 })
  }
}
