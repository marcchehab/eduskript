import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import dns from 'dns'
import { promisify } from 'util'

const resolveTxt = promisify(dns.resolveTxt)

// POST - Verify domain ownership via DNS TXT record
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { domainId } = await params

    // Get the domain
    const domain = await prisma.teacherCustomDomain.findFirst({
      where: {
        id: domainId,
        userId: session.user.id,
      },
    })

    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    if (domain.isVerified) {
      return NextResponse.json({
        success: true,
        message: 'Domain is already verified',
        domain,
      })
    }

    if (!domain.verificationToken) {
      return NextResponse.json(
        { error: 'Domain has no verification token' },
        { status: 400 }
      )
    }

    // Look up the TXT record
    const verificationHost = `_eduskript-verify.${domain.domain}`
    let txtRecords: string[][] = []

    try {
      txtRecords = await resolveTxt(verificationHost)
    } catch (dnsError: unknown) {
      // DNS lookup failed - this is expected if the record doesn't exist yet
      const errorCode = (dnsError as { code?: string })?.code
      if (errorCode === 'ENOTFOUND' || errorCode === 'ENODATA') {
        return NextResponse.json({
          success: false,
          error: 'DNS record not found',
          message: `No TXT record found for ${verificationHost}. Please add the verification record to your DNS.`,
          instructions: {
            type: 'TXT',
            host: '_eduskript-verify',
            value: domain.verificationToken,
          },
        })
      }
      console.error('DNS lookup error:', dnsError)
      return NextResponse.json(
        { error: 'DNS lookup failed. Please try again later.' },
        { status: 500 }
      )
    }

    // Flatten TXT records (they can be split into multiple strings)
    const flattenedRecords = txtRecords.map((record) => record.join(''))

    // Check if any record matches the verification token
    const isVerified = flattenedRecords.some(
      (record) => record.trim() === domain.verificationToken
    )

    if (!isVerified) {
      return NextResponse.json({
        success: false,
        error: 'Verification failed',
        message: `TXT record found but value doesn't match. Found: ${flattenedRecords.join(', ')}`,
        expected: domain.verificationToken,
        instructions: {
          type: 'TXT',
          host: '_eduskript-verify',
          value: domain.verificationToken,
        },
      })
    }

    // Update the domain as verified
    const updatedDomain = await prisma.teacherCustomDomain.update({
      where: { id: domainId },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Domain verified successfully!',
      domain: updatedDomain,
    })
  } catch (error) {
    console.error('Error verifying domain:', error)
    return NextResponse.json(
      { error: 'Failed to verify domain' },
      { status: 500 }
    )
  }
}
