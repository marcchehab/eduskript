import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
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
    const redirectUrl = returnPath.startsWith('http') ? returnPath : `${request.nextUrl.origin}${returnPath}`
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
          pageSlug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          title: true,
          bio: true,
          isAdmin: true,
          accountType: true,
          studentPseudonym: true,
          typographyPreference: true,
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

  // Create JWT token matching NextAuth format
  const jwtToken = await encode({
    token: {
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.image,
      image: user.image,
      pageSlug: user.pageSlug,
      pageName: user.pageName,
      pageDescription: user.pageDescription,
      pageIcon: user.pageIcon,
      title: user.title,
      bio: user.bio,
      isAdmin: user.isAdmin,
      accountType: user.accountType,
      studentPseudonym: user.studentPseudonym,
      typographyPreference: user.typographyPreference,
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
