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

    // Check if user has edit permission on the collection
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        authors: {
          include: { user: true }
        }
      }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    const permissions = checkCollectionPermissions(
      session.user.id,
      collection.authors
    )

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

      // Then create new entries with the correct order
      if (skripts && skripts.length > 0) {
        // Use createMany with skipDuplicates to avoid unique constraint errors
        // This shouldn't happen since we delete all first, but just in case
        await tx.collectionSkript.createMany({
          data: skripts.map((skript: { id: string; order: number }) => ({
            collectionId: collectionId,
            skriptId: skript.id,
            order: skript.order
          }))
        })
      }
    })

    // Revalidate cache for this user's content
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true }
    })
    if (user?.pageSlug) {
      revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })
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