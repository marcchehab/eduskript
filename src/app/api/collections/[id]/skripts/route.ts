import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCollectionPermissions } from '@/lib/permissions'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id: collectionId } = await params
    const { skriptId, order } = await request.json()

    if (!skriptId) {
      return NextResponse.json(
        { error: 'skriptId is required' },
        { status: 400 }
      )
    }

    // Check if user has edit permission on the target collection (via site
    // ownership). Org-admin checks happen further down once we know the site.
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: { site: { select: { userId: true, organizationId: true } } }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    const orgRoles = collection.site?.organizationId
      ? await prisma.organizationMember.findMany({
          where: { userId: session.user.id, organizationId: collection.site.organizationId },
          select: { organizationId: true, role: true },
        })
      : []
    const permissions = checkCollectionPermissions(session.user.id, collection, orgRoles)

    if (!permissions.canEdit) {
      return NextResponse.json(
        { error: 'You need edit permissions on this collection to add skripts' },
        { status: 403 }
      )
    }

    // Check if the skript exists
    const skript = await prisma.skript.findUnique({
      where: { id: skriptId }
    })

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found' },
        { status: 404 }
      )
    }

    // Check if the skript is already in this collection
    const existingEntry = await prisma.collectionSkript.findFirst({
      where: {
        collectionId,
        skriptId
      }
    })

    if (existingEntry) {
      return NextResponse.json(
        { message: 'Skript already exists in this collection', data: existingEntry },
        { status: 200 }
      )
    }

    // Add the skript to the collection (without removing from other collections)
    const result = await prisma.$transaction(async (tx) => {
      const newOrder = order ?? 0

      // Make room at the target position
      await tx.collectionSkript.updateMany({
        where: {
          collectionId,
          order: { gte: newOrder }
        },
        data: {
          order: { increment: 1 }
        }
      })

      // Create the new relationship
      const collectionSkript = await tx.collectionSkript.create({
        data: {
          collectionId,
          skriptId,
          order: newOrder
        }
      })

      return collectionSkript
    })

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error) {
    console.error('Error adding skript to collection:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}