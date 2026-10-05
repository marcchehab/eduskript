import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/internal/tls-allowed?domain=<host>
//
// Caddy's on-demand TLS "ask" check (config/Caddyfile): before issuing a
// certificate for an unknown host, Caddy calls this over 127.0.0.1 and only
// proceeds on 200. 200 = verified custom domain (org or teacher), else 404.
//
// Deliberately uncached, unlike resolveCustomDomain(): that one caches misses
// with revalidate:false, so every random SNI name from a scanner would add a
// permanent cache entry. Here a miss costs at most two indexed lookups, and
// Caddy itself only asks once per host until a cert exists.
//
// Not reachable publicly: Caddy answers 404 for /api/internal/* on every site.
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain')?.toLowerCase().trim()
  if (!domain) return new NextResponse(null, { status: 400 })

  const [org, teacher] = await Promise.all([
    prisma.customDomain.findFirst({ where: { domain, isVerified: true }, select: { id: true } }),
    prisma.teacherCustomDomain.findFirst({ where: { domain, isVerified: true }, select: { id: true } }),
  ])

  return new NextResponse(null, { status: org || teacher ? 200 : 404 })
}
