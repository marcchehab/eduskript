import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function proxy(request: NextRequest) {
  const { pathname, host } = request.nextUrl
  const token = await getToken({ req: request })

  // Handle subdomain routing
  // Get the full hostname (including subdomains) - prioritize Host header for subdomain support
  const fullHostname = request.headers.get('host') || host || ''
  const hostname = fullHostname.split(':')[0] // Remove port if present

  // Determine if this is a subdomain request
  const isMainDomain = hostname === 'localhost' || hostname === 'eduskript.org' || hostname === 'www.eduskript.org'
  const isLocalhost = hostname.endsWith('localhost')

  let subdomain: string | null = null

  if (isLocalhost && hostname !== 'localhost') {
    // Extract subdomain from localhost (e.g., xyz.localhost:3000)
    const parts = hostname.split('.')
    if (parts.length >= 2 && parts[0] !== 'www') {
      subdomain = parts[0]
    }
  } else if (!isMainDomain && !isLocalhost) {
    // For production, check if it's a subdomain or custom domain
    const parts = hostname.split('.')
    if (parts.length >= 3 && parts[0] !== 'www') {
      // This is a subdomain (e.g., xyz.eduskript.org)
      subdomain = parts[0]
    } else if (parts.length >= 2) {
      // For now, we'll handle custom domains via API lookup
      // This avoids Prisma client issues in Edge Runtime
      console.log('Potential custom domain detected:', hostname)
    }
  }

  // If we detected a subdomain, rewrite the URL
  if (subdomain) {
    const url = request.nextUrl.clone()
    url.pathname = `/${subdomain}${pathname}`
    return NextResponse.rewrite(url)
  }

  // Custom domain handling is now integrated above

  // Protect dashboard routes
  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/signin'
      url.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(url)
    }
  }

  // Protect API routes (except auth and public)
  if (pathname.startsWith('/api') && !pathname.startsWith('/api/auth') && !pathname.startsWith('/api/public')) {
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}
