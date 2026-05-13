import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrgAdmin } from '@/lib/org-auth'

interface RouteParams {
  params: Promise<{ orgId: string }>
}

/**
 * GET /api/organizations/[orgId]/available-content
 *
 * Returns collections and skripts that can be added to the organization's page.
 * Strategy: Content where ANY org admin/owner has at least view permission.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId } = await params
    const { error } = await requireOrgAdmin(orgId)
    if (error) return error

    // Get all org admin/owner user IDs
    const orgAdmins = await prisma.organizationMember.findMany({
      where: {
        organizationId: orgId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
    })
    const adminUserIds = orgAdmins.map((m) => m.userId)

    if (adminUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { collections: [], skripts: [] },
      })
    }

    // Fetch collections where any org admin has permission
    const collections = await prisma.collection.findMany({
      where: {
        authors: {
          some: {
            userId: { in: adminUserIds },
          },
        },
      },
      include: {
        authors: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        collectionSkripts: {
          include: {
            skript: true,
          },
        },
      },
      orderBy: { title: 'asc' },
    })

    // Fetch skripts where any org admin has permission
    const skripts = await prisma.skript.findMany({
      where: {
        authors: {
          some: {
            userId: { in: adminUserIds },
          },
        },
      },
      include: {
        authors: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        collectionSkripts: {
          include: {
            collection: {
              select: {
                id: true,
                authors: {
                  include: {
                    user: {
                      select: { id: true, name: true, email: true },
                    },
                  },
                },
              },
            },
          },
        },
        pages: {
          select: { id: true },
        },
      },
      orderBy: { title: 'asc' },
    })

    return NextResponse.json({
      success: true,
      data: { collections, skripts },
    })
  } catch (error) {
    console.error('Error fetching available content:', error)
    return NextResponse.json({ error: 'Failed to fetch available content' }, { status: 500 })
  }
}
