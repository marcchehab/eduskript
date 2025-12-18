import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ orgSlug: string }>
}

/**
 * GET /api/organizations/by-slug/[slug]/teachers
 *
 * Returns teacher members of an organization by slug (for public pages).
 * Query params:
 *   - roles: comma-separated roles to include (default: owner,admin)
 *   - limit: max number of teachers to return (default: 20)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgSlug } = await params
    const { searchParams } = new URL(request.url)
    const rolesParam = searchParams.get('roles') || 'owner,admin'
    const limitParam = searchParams.get('limit') || '20'

    const roles = rolesParam.split(',').filter((r) => ['owner', 'admin', 'member'].includes(r))
    const limit = Math.min(Math.max(1, parseInt(limitParam, 10) || 20), 100)

    // Get organization by slug
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    })

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Get member teachers with specified roles
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId: organization.id,
        role: { in: roles },
        user: {
          accountType: 'teacher',
          pageSlug: { not: null },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            pageSlug: true,
            pageName: true,
            image: true,
            title: true,
          },
        },
      },
      take: limit,
    })

    const teachers = members.map((m) => m.user)

    return NextResponse.json({ success: true, teachers })
  } catch (error) {
    console.error('Error fetching organization teachers:', error)
    return NextResponse.json({ error: 'Failed to fetch teachers' }, { status: 500 })
  }
}
