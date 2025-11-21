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

  // Allow all other routes to proceed
  return NextResponse.next()
}

function getSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0]

  // Split hostname and check for subdomain
  const parts = host.split('.')

  // For localhost development, check for subdomain.localhost pattern
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
    // If we have more than just 'localhost', the first part is the subdomain
    if (parts.length > 1) {
      return parts[0]
    }
    return null
  }

  // For IP addresses (127.0.0.1, 192.168.x.x, 10.x.x.x), no subdomain
  if (host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')) {
    return null
  }

  // For *.koyeb.app domains (eduskript.koyeb.app), there's no subdomain
  // Only eduskript.koyeb.app is the base domain, anything like teacher.eduskript.koyeb.app would be a subdomain
  if (parts.length === 3 && parts[parts.length - 2] === 'koyeb' && parts[parts.length - 1] === 'app') {
    return null
  }

  // For production domains, need at least 3 parts for a subdomain (e.g., teacher.eduskript.org)
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
