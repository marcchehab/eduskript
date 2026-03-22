import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireOrgAdmin } from '@/lib/org-auth'
import { CACHE_TAGS } from '@/lib/cached-queries'

interface RouteParams {
  params: Promise<{ orgId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId } = await params
    const { error } = await requireOrgAdmin(orgId)
    if (error) return error

    const pageLayout = await prisma.orgPageLayout.findUnique({
      where: { organizationId: orgId },
      include: {
        items: {
          orderBy: { order: 'asc' },
        },
      },
    })

    return NextResponse.json({
      success: true,
      data: pageLayout || { items: [] },
    })
  } catch (error) {
    console.error('Error fetching org page layout:', error)
    return NextResponse.json({ error: 'Failed to fetch page layout' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { orgId } = await params
    const { error, session } = await requireOrgAdmin(orgId)
    if (error) return error

    const { items } = await request.json()

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'Items must be an array' }, { status: 400 })
    }

    // Get all org admin/owner user IDs to check content permissions
    const orgAdmins = await prisma.organizationMember.findMany({
      where: {
        organizationId: orgId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
    })
    const adminUserIds = orgAdmins.map((m) => m.userId)

    // SECURITY: Validate that at least one org admin has permission on each item
    const validatedItems: Array<{ id: string; type: string }> = []

    for (const item of items) {
      if (!item.id || !item.type) {
        continue // Skip invalid items
      }

      if (item.type === 'collection') {
        // Check if any org admin has permission on this collection
        const collection = await prisma.collection.findFirst({
          where: {
            id: item.id,
            authors: {
              some: {
                userId: { in: adminUserIds },
              },
            },
          },
        })

        if (collection) {
          validatedItems.push(item)
        } else {
          console.warn(
            `[Org Page Layout] User ${session?.user?.email} attempted to add collection ${item.id} - no org admin has permission`
          )
        }
      } else if (item.type === 'skript') {
        // Check if any org admin has permission on this skript
        const skript = await prisma.skript.findFirst({
          where: {
            id: item.id,
            authors: {
              some: {
                userId: { in: adminUserIds },
              },
            },
          },
        })

        if (skript) {
          validatedItems.push(item)
        } else {
          console.warn(
            `[Org Page Layout] User ${session?.user?.email} attempted to add skript ${item.id} - no org admin has permission`
          )
        }
      }
    }

    // Upsert page layout with only validated items
    const pageLayout = await prisma.orgPageLayout.upsert({
      where: { organizationId: orgId },
      update: {
        items: {
          deleteMany: {},
          create: validatedItems.map((item, index) => ({
            type: item.type,
            contentId: item.id,
            order: index,
          })),
        },
      },
      create: {
        organizationId: orgId,
        items: {
          create: validatedItems.map((item, index) => ({
            type: item.type,
            contentId: item.id,
            order: index,
          })),
        },
      },
      include: {
        items: {
          orderBy: { order: 'asc' },
        },
        organization: {
          select: { slug: true },
        },
      },
    })

    // Revalidate org content cache so sidebar updates
    if (pageLayout.organization?.slug) {
      revalidateTag(CACHE_TAGS.organization(pageLayout.organization.slug), { expire: 0 })
      revalidateTag(CACHE_TAGS.orgContent(pageLayout.organization.slug), { expire: 0 })
    }

    return NextResponse.json({ success: true, data: pageLayout })
  } catch (error) {
    console.error('Error saving org page layout:', error)
    return NextResponse.json({ error: 'Failed to save page layout' }, { status: 500 })
  }
}
