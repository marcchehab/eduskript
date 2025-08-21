import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
    const { chapterIds } = body

    if (!Array.isArray(chapterIds)) {
      return NextResponse.json(
        { error: 'chapterIds must be an array' },
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
        chapters: true
      }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    // Verify all chapter IDs belong to this collection
    const collectionChapterIds = collection.chapters.map((c) => c.id)
    const allChapterIdsValid = chapterIds.every((id: string) => collectionChapterIds.includes(id))
    
    if (!allChapterIdsValid || chapterIds.length !== collection.chapters.length) {
      return NextResponse.json(
        { error: 'Invalid chapter IDs provided' },
        { status: 400 }
      )
    }

    // Update chapter orders
    const updates = chapterIds.map((chapterId: string, index: number) => 
      prisma.chapter.update({
        where: { id: chapterId },
        data: { order: index + 1 }
      })
    )

    await prisma.$transaction(updates)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error reordering chapters:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 