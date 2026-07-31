import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { diagnoseDomain } from '@/lib/domain-diagnostics'

// GET - Full configuration check (TXT, CNAME, activation, HTTPS) for one of
// the caller's own domains. Scoped by userId: the check makes the server issue
// an outbound request to the domain, so it must never run on arbitrary input.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { domainId } = await params

    const domain = await prisma.teacherCustomDomain.findFirst({
      where: { id: domainId, userId: session.user.id },
      include: { site: { select: { pageName: true, slug: true } } },
    })

    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    const result = await diagnoseDomain({
      domain: domain.domain,
      verificationToken: domain.verificationToken,
      isVerified: domain.isVerified,
      siteLabel: domain.site?.pageName ?? domain.site?.slug ?? null,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error diagnosing domain:', error)
    return NextResponse.json({ error: 'Failed to check domain' }, { status: 500 })
  }
}
