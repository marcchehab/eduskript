import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrgAdmin } from '@/lib/org-auth'
import { diagnoseDomain } from '@/lib/domain-diagnostics'

// GET - Full configuration check (TXT, CNAME, activation, HTTPS) for an
// organization domain. Admin-only and scoped to the org: the check makes the
// server issue an outbound request to the domain.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; domainId: string }> }
) {
  try {
    const { orgId, domainId } = await params

    const { error } = await requireOrgAdmin(orgId)
    if (error) return error

    const domain = await prisma.customDomain.findFirst({
      where: { id: domainId, organizationId: orgId },
      include: { organization: { select: { name: true } } },
    })

    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    const result = await diagnoseDomain({
      domain: domain.domain,
      verificationToken: domain.verificationToken,
      isVerified: domain.isVerified,
      siteLabel: domain.organization?.name ?? null,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error diagnosing org domain:', error)
    return NextResponse.json({ error: 'Failed to check domain' }, { status: 500 })
  }
}
