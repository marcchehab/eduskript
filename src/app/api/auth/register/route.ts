import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { generateSlug } from '@/lib/markdown'
import { sendEmail, generateVerificationEmailContent } from '@/lib/email'
import { randomBytes } from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const { name, email, password, subdomain } = await request.json()

    // Validate input
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      )
    }

    // Check if subdomain is taken (if provided)
    if (subdomain) {
      const normalizedSubdomain = generateSlug(subdomain)
      const existingSubdomain = await prisma.user.findUnique({
        where: { subdomain: normalizedSubdomain }
      })

      if (existingSubdomain) {
        return NextResponse.json(
          { error: 'This subdomain is already taken' },
          { status: 400 }
        )
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        hashedPassword,
        subdomain: subdomain ? generateSlug(subdomain) : null,
        emailVerified: null, // Explicitly set to null - will be updated when verified
      }
    })

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
        verificationUrl,
        email
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
        subdomain: user.subdomain,
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
