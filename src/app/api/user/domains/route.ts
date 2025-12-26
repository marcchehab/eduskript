import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'

// GET - List user's custom domains
export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only teachers can have custom domains
    if (session.user.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can have custom domains' },
        { status: 403 }
      )
    }

    const domains = await prisma.teacherCustomDomain.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    })

    return NextResponse.json({ domains })
  } catch (error) {
    console.error('Error fetching user domains:', error)
    return NextResponse.json(
      { error: 'Failed to fetch domains' },
      { status: 500 }
    )
  }
}

// POST - Add a new custom domain
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only teachers can have custom domains
    if (session.user.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can have custom domains' },
        { status: 403 }
      )
    }

    // Check if user's organization allows teacher custom domains
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: session.user.id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            allowTeacherCustomDomains: true,
          },
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'You must belong to an organization to add custom domains' },
        { status: 403 }
      )
    }

    if (!membership.organization.allowTeacherCustomDomains) {
      return NextResponse.json(
        { error: `Your organization (${membership.organization.name}) does not allow teacher custom domains` },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { domain } = body

    // Validate domain format
    if (!domain || typeof domain !== 'string') {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    // Normalize domain (lowercase, remove protocol and trailing slash)
    const normalizedDomain = domain
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .trim()

    // Basic domain validation
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
    if (!domainRegex.test(normalizedDomain)) {
      return NextResponse.json(
        { error: 'Invalid domain format. Please enter a valid domain like "example.com"' },
        { status: 400 }
      )
    }

    // Check if domain is already claimed by an organization
    const existingOrgDomain = await prisma.customDomain.findUnique({
      where: { domain: normalizedDomain },
    })

    if (existingOrgDomain) {
      return NextResponse.json(
        { error: 'This domain is already claimed by an organization' },
        { status: 400 }
      )
    }

    // Check if domain is already claimed by another teacher
    const existingTeacherDomain = await prisma.teacherCustomDomain.findUnique({
      where: { domain: normalizedDomain },
    })

    if (existingTeacherDomain) {
      if (existingTeacherDomain.userId === session.user.id) {
        return NextResponse.json(
          { error: 'You have already added this domain' },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: 'This domain is already claimed by another teacher' },
        { status: 400 }
      )
    }

    // Generate verification token
    const verificationToken = randomBytes(32).toString('hex')

    // Create the custom domain
    const customDomain = await prisma.teacherCustomDomain.create({
      data: {
        domain: normalizedDomain,
        userId: session.user.id,
        verificationToken,
        isVerified: false,
        isPrimary: false,
      },
    })

    return NextResponse.json({
      domain: customDomain,
      verificationInstructions: {
        type: 'TXT',
        host: `_eduskript-verify.${normalizedDomain}`,
        value: verificationToken,
        instructions: `Add a TXT record to your DNS with:\n\nHost: _eduskript-verify\nValue: ${verificationToken}\n\nThis proves you own the domain.`,
      },
    })
  } catch (error) {
    console.error('Error adding custom domain:', error)
    return NextResponse.json({ error: 'Failed to add custom domain' }, { status: 500 })
  }
}
