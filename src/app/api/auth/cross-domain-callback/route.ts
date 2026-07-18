import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { encode } from 'next-auth/jwt'

/**
 * Cross-domain auth callback
 * GET /api/auth/cross-domain-callback?token=xxx&returnPath=/grundjahr/...
 *
 * This endpoint:
 * 1. Validates the one-time token
 * 2. Creates a session cookie for the custom domain
 * 3. Redirects to the return path
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const token = searchParams.get('token')
  const returnPath = searchParams.get('returnPath') || '/'

  // Tunnel domains bypass the DB token — production encodes the JWT directly
  const jwtParam = searchParams.get('jwt')
  if (jwtParam) {
    const isProduction = process.env.NODE_ENV === 'production'
    const cookieName = isProduction ? '__Secure-next-auth.session-token' : 'next-auth.session-token'
    // Use the Host header directly — request.url mixes X-Forwarded-Proto (https)
    // with the internal hostname (localhost:3000), producing https://localhost:3000
    const host = request.headers.get('host') || 'localhost:3000'
    const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
    const redirectUrl = returnPath.startsWith('http') ? returnPath : `${protocol}://${host}${returnPath}`
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.set(cookieName, jwtParam, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })
    return response
  }

  if (!token) {
    return NextResponse.json(
      { error: 'Missing token' },
      { status: 400 }
    )
  }

  // Look up and validate the token
  const crossDomainToken = await prisma.crossDomainToken.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          title: true,
          bio: true,
          isAdmin: true,
          accountType: true,
          studentPseudonym: true,
          // Token carries the user's primary site (a user may own several).
          sites: {
            orderBy: PRIMARY_SITE_ORDER,
            take: 1,
            select: {
              slug: true,
              pageName: true,
              pageDescription: true,
              pageIcon: true,
              typographyPreference: true,
            },
          },
        }
      }
    }
  })

  if (!crossDomainToken) {
    return NextResponse.json(
      { error: 'Invalid token' },
      { status: 400 }
    )
  }

  // Check if token is expired
  if (crossDomainToken.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.crossDomainToken.delete({ where: { id: crossDomainToken.id } })
    return NextResponse.json(
      { error: 'Token expired' },
      { status: 400 }
    )
  }

  // Check if token was already used
  if (crossDomainToken.usedAt) {
    return NextResponse.json(
      { error: 'Token already used' },
      { status: 400 }
    )
  }

  // Mark token as used
  await prisma.crossDomainToken.update({
    where: { id: crossDomainToken.id },
    data: { usedAt: new Date() }
  })

  const user = crossDomainToken.user

  // If the custom domain the user landed on points to a specific site they own,
  // carry THAT site in the session so the dashboard branding/routing match the
  // domain — not just their primary site. Falls back to the primary site.
  const domainSite = await prisma.teacherCustomDomain.findFirst({
    where: { domain: crossDomainToken.domain, userId: user.id, isVerified: true },
    select: {
      site: {
        select: {
          slug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          typographyPreference: true,
        },
      },
    },
  })
  const sessionSite = domainSite?.site ?? user.sites[0] ?? null

  // Create JWT token matching NextAuth format
  const jwtToken = await encode({
    token: {
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.image,
      image: user.image,
      pageSlug: sessionSite?.slug ?? null,
      pageName: sessionSite?.pageName ?? null,
      pageDescription: sessionSite?.pageDescription ?? null,
      pageIcon: sessionSite?.pageIcon ?? null,
      title: user.title,
      bio: user.bio,
      isAdmin: user.isAdmin,
      accountType: user.accountType,
      studentPseudonym: user.studentPseudonym,
      typographyPreference: sessionSite?.typographyPreference ?? null,
    },
    secret: process.env.NEXTAUTH_SECRET!,
  })

  // Build redirect response using the domain from the token
  // (request.url may be internal container URL on platforms like Koyeb)
  const redirectUrl = `https://${crossDomainToken.domain}${returnPath}`
  const response = NextResponse.redirect(redirectUrl)

  // Set session cookie
  // Use the same cookie name NextAuth uses in production
  const isProduction = process.env.NODE_ENV === 'production'
  const cookieName = isProduction
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'

  response.cookies.set(cookieName, jwtToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    // Match NextAuth default session expiry (30 days)
    maxAge: 30 * 24 * 60 * 60,
  })

  return response
}
