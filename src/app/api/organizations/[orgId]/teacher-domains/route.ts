import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrgAdmin } from '@/lib/org-auth'

// GET - List all teacher custom domains for teachers in this organization
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params

    // Only admins can view teacher domains
    const { error } = await requireOrgAdmin(orgId)
    if (error) return error

    // Get all teacher domains for teachers who are members of this org
    const teacherDomains = await prisma.teacherCustomDomain.findMany({
      where: {
        user: {
          organizationMemberships: {
            some: {
              organizationId: orgId,
            },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            pageSlug: true,
            image: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    })

    return NextResponse.json({ domains: teacherDomains })
  } catch (error) {
    console.error('Error fetching teacher domains:', error)
    return NextResponse.json(
      { error: 'Failed to fetch teacher domains' },
      { status: 500 }
    )
  }
}
