import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const addAuthorSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  permission: z.enum(['author', 'viewer'], { required_error: 'Permission must be author or viewer' })
})

// GET /api/skripts/[id]/authors - List all authors of a skript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: skriptId } = await params

    // Verify the user has access to this skript
    const skript = await prisma.skript.findFirst({
      where: {
        id: skriptId,
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

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found or access denied' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: skript.authors })
  } catch (error) {
    console.error('Error fetching skript authors:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/skripts/[id]/authors - Add a new author to a skript
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: skriptId } = await params
    const body = await request.json()
    
    const validatedData = addAuthorSchema.parse(body)

    // Verify the user has access to this skript
    const skript = await prisma.skript.findFirst({
      where: {
        id: skriptId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found or you do not have permission to add authors' },
        { status: 404 }
      )
    }

    // Verify the user exists
    const userToAdd = await prisma.user.findUnique({
      where: { id: validatedData.userId },
      select: { id: true, name: true, email: true }
    })

    if (!userToAdd) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Check if user is already an author
    const existingAuthor = await prisma.skriptAuthor.findFirst({
      where: {
        skriptId,
        userId: validatedData.userId
      }
    })

    if (existingAuthor) {
      return NextResponse.json(
        { error: 'User is already an author of this skript' },
        { status: 400 }
      )
    }

    // Add the new author
    const newAuthor = await prisma.skriptAuthor.create({
      data: {
        skriptId,
        userId: validatedData.userId,
        permission: validatedData.permission
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            title: true
          }
        }
      }
    })

    return NextResponse.json({ success: true, data: newAuthor }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error adding skript author:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 