import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCollectionPermissions } from '@/lib/permissions'
import { CACHE_TAGS } from '@/lib/cached-queries'

export async function PUT(
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
    const { skripts } = await request.json()

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
        { error: 'Permission denied' },
        { status: 403 }
      )
    }

    // Start a transaction to update all skripts atomically
    await prisma.$transaction(async (tx) => {
      // First, remove all existing CollectionSkript entries for this collection
      await tx.collectionSkript.deleteMany({
        where: {
          collectionId: collectionId
        }
      })

      // Then create new entries with the correct order. skipDuplicates
      // guards against a client payload that lists the same skript twice —
      // without it createMany throws P2002 on the (collectionId, skriptId)
      // unique constraint and the whole save 500s.
      if (skripts && skripts.length > 0) {
        await tx.collectionSkript.createMany({
          data: skripts.map((skript: { id: string; order: number }) => ({
            collectionId: collectionId,
            skriptId: skript.id,
            order: skript.order
          })),
          skipDuplicates: true,
        })
      }
    })

    const userSite = await prisma.site.findUnique({
      where: { userId: session.user.id },
      select: { slug: true }
    })
    if (userSite?.slug) {
      revalidateTag(CACHE_TAGS.teacherContent(userSite.slug), { expire: 0 })
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${skripts?.length || 0} skripts in collection`
    })
  } catch (error) {
    console.error('Error updating collection skripts:', error)
    return NextResponse.json(
      { error: 'Failed to update collection skripts' },
      { status: 500 }
    )
  }
}