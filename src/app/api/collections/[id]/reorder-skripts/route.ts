import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { skriptIds } = body

    if (!Array.isArray(skriptIds)) {
      return NextResponse.json(
        { error: 'skriptIds must be an array' },
        { status: 400 }
      )
    }

    // Check if collection exists and belongs to user
    const collection = await prisma.collection.findFirst({
      where: {
        id,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        collectionSkripts: {
          include: {
            skript: true
          }
        }
      }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    // Verify all skript IDs belong to this collection
    const collectionSkriptIds = collection.collectionSkripts.map((cs) => cs.skript.id)
    const allSkriptIdsValid = skriptIds.every((id: string) => collectionSkriptIds.includes(id))

    if (!allSkriptIdsValid || skriptIds.length !== collection.collectionSkripts.length) {
      return NextResponse.json(
        { error: 'Invalid skript IDs provided' },
        { status: 400 }
      )
    }

    // Update skript orders in junction table
    const updates = skriptIds.map((skriptId: string, index: number) => {
      return prisma.collectionSkript.update({
        where: {
          collectionId_skriptId: {
            collectionId: id,
            skriptId: skriptId
          }
        },
        data: { order: index }
      })
    })

    await prisma.$transaction(updates)

    // Revalidate cache for this user's content
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true }
    })
    if (user?.pageSlug) {
      revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error reordering skripts:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 