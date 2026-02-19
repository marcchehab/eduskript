import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { encode } from 'next-auth/jwt'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:cross-domain')

/**
 * Generate a cross-domain auth token
 * GET /api/auth/cross-domain?returnDomain=informatikgarten.ch&returnPath=/grundjahr/...
 *
 * This endpoint:
 * 1. Verifies the user is authenticated
 * 2. Validates the return domain is a registered custom domain
 * 3. Generates a one-time token
 * 4. Redirects to the custom domain with the token
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const returnDomain = searchParams.get('returnDomain')
  const returnPath = searchParams.get('returnPath') || '/'

  log.info(`Cross-domain auth requested: returnDomain="${returnDomain}", returnPath="${returnPath}"`)

  if (!returnDomain) {
    log.warn('Cross-domain auth rejected: missing returnDomain parameter')
    return NextResponse.json(
      { error: 'Missing return domain' },
      { status: 400 }
    )
  }

  // Strip www. prefix for lookup
  const domainWithoutWww = returnDomain.replace(/^www\./, '')

  // Dev tunnel domains (ngrok etc.) are always allowed — they're not in the DB
  const isTunnelDomain = domainWithoutWww.endsWith('.ngrok-free.dev') || domainWithoutWww.endsWith('.ngrok-free.app') || domainWithoutWww.endsWith('.ngrok.io')

  // Validate return domain is a registered custom domain
  const customDomain = isTunnelDomain ? { domain: returnDomain, userId: null } : await prisma.teacherCustomDomain.findFirst({
    where: {
      OR: [
        { domain: returnDomain },
        { domain: domainWithoutWww },
        { domain: `www.${domainWithoutWww}` },
      ],
      isVerified: true,
    },
    select: { domain: true, userId: true }
  })

  if (!customDomain) {
    log.warn(`Cross-domain auth rejected: "${returnDomain}" is not a verified custom domain`)
    return NextResponse.json(
      { error: 'Invalid or unverified custom domain' },
      { status: 400 }
    )
  }

  // Get current session
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    log.info(`Cross-domain auth: user not authenticated, redirecting to sign in`)
    const signInUrl = `/auth/signin?callbackUrl=${encodeURIComponent(request.url)}`
    return NextResponse.redirect(new URL(signInUrl, request.url))
  }

  // Tunnel domains (ngrok etc.) can't query production's DB for token lookup,
  // so we encode the session JWT directly into the redirect URL instead.
  if (isTunnelDomain) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true, name: true, email: true, image: true,
        pageSlug: true, pageName: true, pageDescription: true, pageIcon: true,
        title: true, bio: true, isAdmin: true, accountType: true,
        studentPseudonym: true, typographyPreference: true,
      }
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    const jwt = await encode({
      token: {
        id: user.id, name: user.name, email: user.email,
        picture: user.image, image: user.image,
        pageSlug: user.pageSlug, pageName: user.pageName,
        pageDescription: user.pageDescription, pageIcon: user.pageIcon,
        title: user.title, bio: user.bio, isAdmin: user.isAdmin,
        accountType: user.accountType, studentPseudonym: user.studentPseudonym,
        typographyPreference: user.typographyPreference,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    })
    log.info(`Tunnel domain: JWT sent directly for user=${session.user.id}, domain="${returnDomain}"`)
    const redirectUrl = `https://${returnDomain}/api/auth/cross-domain-callback?jwt=${encodeURIComponent(jwt)}&returnPath=${encodeURIComponent(returnPath)}`
    return NextResponse.redirect(redirectUrl)
  }

  // Generate one-time token
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 1000) // 1 minute expiry

  // Store token in database
  await prisma.crossDomainToken.create({
    data: {
      token,
      userId: session.user.id,
      domain: returnDomain,
      expiresAt,
    }
  })

  log.info(`Cross-domain token issued for user=${session.user.id}, domain="${returnDomain}", accountType="${session.user.accountType}"`)

  // Redirect to custom domain with token
  const redirectUrl = `https://${returnDomain}/api/auth/cross-domain-callback?token=${token}&returnPath=${encodeURIComponent(returnPath)}`
  return NextResponse.redirect(redirectUrl)
}
