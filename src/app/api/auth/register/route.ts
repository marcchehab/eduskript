import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag, revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { generateSlug } from '@/lib/markdown'
import { sendEmail, generateVerificationEmailContent } from '@/lib/email'
import { randomBytes } from 'crypto'
import { registrationRateLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { validatePassword } from '@/lib/password-validation'
import { createTrialSubscription } from '@/lib/trial'
import { CACHE_TAGS } from '@/lib/cached-queries'

/**
 * Generates a page slug from an email address
 * e.g., "john.doe@example.com" -> "john-doe"
 */
function generatePageSlugFromEmail(email: string): string {
  const localPart = email.split('@')[0]

  let slug = localPart
    .toLowerCase()
    .replace(/[._]/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (slug.length < 3) {
    slug = `user-${slug || 'x'}`
  }

  if (slug.length > 40) {
    slug = slug.substring(0, 40)
  }

  return slug
}

/**
 * Finds a unique page slug, adding numeric suffix if needed (e.g., john-doe, john-doe-2, john-doe-3)
 */
async function findUniquePageSlug(baseSlug: string): Promise<string> {
  // URL slugs live on Site; uniqueness is global across user/org sites.
  const existing = await prisma.site.findUnique({
    where: { slug: baseSlug },
    select: { id: true }
  })

  if (!existing) {
    return baseSlug
  }

  for (let i = 2; i <= 100; i++) {
    const candidateSlug = `${baseSlug}-${i}`
    const exists = await prisma.site.findUnique({
      where: { slug: candidateSlug },
      select: { id: true }
    })

    if (!exists) {
      return candidateSlug
    }
  }

  return `${baseSlug}-${Date.now().toString(36)}`
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const identifier = getClientIdentifier(request)
    const rateLimit = registrationRateLimiter.check(identifier)

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many registration attempts. Please try again in ${rateLimit.retryAfter} seconds.`,
          retryAfter: rateLimit.retryAfter
        },
        {
          status: 429,
          headers: {
            'Retry-After': rateLimit.retryAfter?.toString() || '3600',
            'X-RateLimit-Limit': '3',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(rateLimit.resetAt).toISOString()
          }
        }
      )
    }

    const { name, email, password, pageSlug: requestedPageSlug } = await request.json()

    // Validate input
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    // Validate password strength
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return NextResponse.json(
        {
          error: 'Password does not meet security requirements',
          details: passwordValidation.errors,
          strength: passwordValidation.strength
        },
        { status: 400 }
      )
    }

    // Check if user already exists - return same response to prevent email enumeration
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      // Return success-like response to prevent email enumeration
      // Don't reveal whether the email already exists
      return NextResponse.json({
        message: 'If this email is not already registered, a verification email has been sent.',
        requiresEmailVerification: true
      })
    }

    // Generate unique page slug (lives on Site now).
    // If user provided one, use it (with uniqueness check); otherwise generate from email
    let pageSlug: string
    if (requestedPageSlug) {
      const normalizedPageSlug = generateSlug(requestedPageSlug)
      const existingPageSlug = await prisma.site.findUnique({
        where: { slug: normalizedPageSlug }
      })

      if (existingPageSlug) {
        return NextResponse.json(
          { error: 'This page slug is already taken' },
          { status: 400 }
        )
      }
      pageSlug = normalizedPageSlug
    } else {
      // Auto-generate from email with uniqueness check
      const baseSlug = generatePageSlugFromEmail(email)
      pageSlug = await findUniquePageSlug(baseSlug)
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create user + their Site row in a transaction so the URL slug lands
    // atomically with the account.
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name,
          email,
          hashedPassword,
          emailVerified: null,
        },
      })
      await tx.site.create({
        data: { slug: pageSlug, userId: u.id },
      })
      return u
    })

    // Bust any cached `null` for this pageSlug. If anything (a probe, a
    // typo, a link preview) hit /<pageSlug> before signup, getTeacherByPageSlug
    // / getTeacherWithLayout cached null indefinitely (revalidate: false) and
    // the new user would 404 until restart. Mirrors the pattern in
    // /api/user/profile when a pageSlug changes.
    revalidateTag(CACHE_TAGS.user(pageSlug), { expire: 0 })
    revalidateTag(CACHE_TAGS.teacherContent(pageSlug), { expire: 0 })
    revalidatePath(`/${pageSlug}`)

    // Auto-assign teacher to the default "eduskript" organization
    const defaultOrgSite = await prisma.site.findUnique({
      where: { slug: 'eduskript' },
      select: { organizationId: true },
    })
    const defaultOrg = defaultOrgSite?.organizationId
      ? { id: defaultOrgSite.organizationId }
      : null

    if (defaultOrg) {
      await prisma.organizationMember.create({
        data: {
          organizationId: defaultOrg.id,
          userId: user.id,
          role: 'member',
        }
      })
    }

    // Auto-start trial for teacher accounts (no-op if no default trial plan configured)
    await createTrialSubscription(user.id)

    // Generate verification token
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Store verification token
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires
      }
    })

    // Generate verification URL
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const verificationUrl = `${baseUrl}/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`

    // Generate and send verification email
    try {
      const { htmlContent, textContent } = generateVerificationEmailContent(
        verificationUrl
      )

      await sendEmail({
        to: email,
        subject: 'Verify your email address - Eduskript',
        htmlContent,
        textContent
      })
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError)
      // Don't fail registration if email fails - user can request resend
    }

    // Return success (without password)
    return NextResponse.json({
      message: 'User created successfully. Please check your email to verify your account.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        pageSlug,
        emailVerified: user.emailVerified,
      },
      requiresEmailVerification: true
    })

  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
