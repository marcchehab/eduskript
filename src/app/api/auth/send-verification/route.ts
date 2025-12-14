import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, generateVerificationEmailContent } from '@/lib/email'
import { randomBytes } from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    // Check if user exists and needs verification
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerified: true }
    })

    // Return generic response to prevent email enumeration
    // We only actually send an email if: user exists AND email not verified
    const genericResponse = {
      message: 'If an account exists with this email and requires verification, a verification email has been sent.'
    }

    if (!user || user.emailVerified) {
      // Don't reveal whether user exists or is already verified
      return NextResponse.json(genericResponse)
    }

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

    // Generate email content
    const { htmlContent, textContent } = generateVerificationEmailContent(
      verificationUrl
    )

    // Send verification email
    await sendEmail({
      to: email,
      subject: 'Verify your email address - Eduskript',
      htmlContent,
      textContent
    })

    return NextResponse.json(genericResponse)

  } catch (error) {
    console.error('Failed to send verification email:', error)
    return NextResponse.json(
      { error: 'Failed to send verification email' },
      { status: 500 }
    )
  }
}