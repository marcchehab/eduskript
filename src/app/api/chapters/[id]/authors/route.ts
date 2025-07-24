import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const addAuthorSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1, 'Role is required')
})

// GET /api/chapters/[id]/authors - List all authors of a chapter
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: chapterId } = await params

    // Verify the user has access to this chapter
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        authors: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!chapter) {
      return NextResponse.json(
        { error: 'Chapter not found or access denied' },
        { status: 404 }
      )
    }

    // Return all authors
    const allAuthors = chapter.authors.map(ca => ({
      id: ca.user.id,
      name: ca.user.name,
      email: ca.user.email,
      role: ca.role,
      addedAt: ca.createdAt
    }))

    return NextResponse.json(allAuthors)
  } catch (error) {
    console.error('Error fetching chapter authors:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/chapters/[id]/authors - Add a new author to a chapter
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: chapterId } = await params
    const body = await request.json()
    
    const validatedData = addAuthorSchema.parse(body)

    // Verify the user has access to this chapter
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!chapter) {
      return NextResponse.json(
        { error: 'Chapter not found or you do not have permission to add authors' },
        { status: 404 }
      )
    }

    // Find the user to add
    const userToAdd = await prisma.user.findUnique({
      where: { email: validatedData.email },
      select: { id: true, name: true, email: true }
    })

    if (!userToAdd) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Check if user is already an author
    const existingAuthor = await prisma.chapterAuthor.findFirst({
      where: {
        chapterId,
        userId: userToAdd.id
      }
    })

    if (existingAuthor) {
      return NextResponse.json(
        { error: 'User is already an author of this chapter' },
        { status: 400 }
      )
    }

    // Add the new author
    const newAuthor = await prisma.chapterAuthor.create({
      data: {
        chapterId,
        userId: userToAdd.id,
        role: validatedData.role
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

    return NextResponse.json({
      id: newAuthor.user.id,
      name: newAuthor.user.name,
      email: newAuthor.user.email,
      role: newAuthor.role,
      addedAt: newAuthor.createdAt
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error adding chapter author:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 