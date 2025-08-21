import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSlug } from '@/lib/markdown'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { title, description, slug, collectionId } = await request.json()

    // Validate input
    if (!title || !slug || !collectionId) {
      return NextResponse.json(
        { error: 'Title, slug, and collection ID are required' },
        { status: 400 }
      )
    }

    // Verify the user is an author of the collection
    const collection = await prisma.collection.findFirst({
      where: {
        id: collectionId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found or access denied' },
        { status: 404 }
      )
    }

    // Normalize slug
    const normalizedSlug = generateSlug(slug)

    // Check if slug is already taken in this collection
    const existingChapter = await prisma.chapter.findFirst({
      where: {
        collectionId,
        slug: normalizedSlug
      }
    })

    if (existingChapter) {
      return NextResponse.json(
        { error: 'A chapter with this slug already exists in this collection' },
        { status: 409 }
      )
    }

    // Get the next order number
    const lastChapter = await prisma.chapter.findFirst({
      where: { collectionId },
      orderBy: { order: 'desc' }
    })

    const nextOrder = (lastChapter?.order ?? 0) + 1

    // Create chapter with the current user as the first author
    const chapter = await prisma.chapter.create({
      data: {
        title,
        description,
        slug: normalizedSlug,
        order: nextOrder,
        collectionId,
        authors: {
          create: {
            userId: session.user.id,
            role: "author"
          }
        }
      },
      include: {
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    revalidatePath('/dashboard')
    return NextResponse.json(chapter)
  } catch (error) {
    console.error('Error creating chapter:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
