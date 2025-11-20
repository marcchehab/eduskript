import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Define routes that should NOT be treated as domain routes
const PROTECTED_PATHS = [
  '/dashboard',
  '/api',
  '/auth',
  '/classes',
  '/consent',
  '/_next',
  '/favicon.ico',
  '/uploads',
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hostname = request.headers.get('host') || ''

  // Skip middleware for protected paths
  if (PROTECTED_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // Skip middleware for root path
  if (pathname === '/') {
    // Check if we're on a subdomain
    const subdomain = getSubdomain(hostname)

    // If on a subdomain, rewrite to [domain] route
    if (subdomain && subdomain !== 'www') {
      const url = request.nextUrl.clone()
      url.pathname = `/${subdomain}`
      return NextResponse.rewrite(url)
    }

    return NextResponse.next()
  }

  // Handle subdomain routing
  const subdomain = getSubdomain(hostname)

  if (subdomain && subdomain !== 'www') {
    // We're on a subdomain, rewrite to [domain] route
    const url = request.nextUrl.clone()
    url.pathname = `/${subdomain}${pathname}`
    return NextResponse.rewrite(url)
  }

  // If not on a subdomain and path doesn't match protected routes,
  // check if it looks like a domain route (single path segment)
  const pathSegments = pathname.split('/').filter(Boolean)

  // In development (localhost), block single-segment paths from being treated as domain routes
  // These paths should return 404 unless they match a specific app route
  if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
    if (pathSegments.length === 1 && !PROTECTED_PATHS.some(path => pathname.startsWith(path))) {
      // Return 404 for paths like /eduadmin in development
      // In production, these would be accessed via subdomain (eduadmin.eduskript.org)
      return new NextResponse(null, { status: 404 })
    }
  }

  return NextResponse.next()
}

function getSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0]

  // For localhost, no subdomain
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')) {
    return null
  }

  // Split hostname and check for subdomain
  const parts = host.split('.')

  // Need at least 3 parts for a subdomain (e.g., teacher.eduskript.org)
  if (parts.length < 3) {
    return null
  }

  // The first part is the subdomain
  return parts[0]
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
