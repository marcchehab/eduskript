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

    // Fetch collections that belong to the org's site, OR to a personal site
    // owned by any org admin (still useful so admins can pull their personal
    // collections onto the org page).
    const collections = await prisma.collection.findMany({
      where: {
        OR: [
          { site: { organizationId: orgId } },
          { site: { userId: { in: adminUserIds } } },
        ],
      },
      include: {
        site: { select: { userId: true, organizationId: true } },
        collectionSkripts: {
          include: {
            // Mirror /api/collections: the page builder reads skript.authors
            // off the dragged collection to compute per-skript permissions.
            // Without authors here the drag handler sees `undefined` and
            // renders every skript as "Access Revoked" until a refresh.
            skript: {
              include: {
                authors: {
                  include: {
                    user: { select: { id: true, name: true, email: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { title: 'asc' },
    })

    // Fetch skripts where any org admin is a SkriptAuthor.
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
                title: true,
                site: { select: { userId: true, organizationId: true } },
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
