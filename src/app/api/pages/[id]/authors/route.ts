import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const addAuthorSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1, 'Role is required')
})

// GET /api/pages/[id]/authors - List all authors of a page
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: pageId } = await params

    // Verify the user has access to this page
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
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

    if (!page) {
      return NextResponse.json(
        { error: 'Page not found or access denied' },
        { status: 404 }
      )
    }

    // Return all authors
    const allAuthors = page.authors.map(pa => ({
      id: pa.user.id,
      name: pa.user.name,
      email: pa.user.email,
      role: pa.role,
      addedAt: pa.createdAt
    }))

    return NextResponse.json(allAuthors)
  } catch (error) {
    console.error('Error fetching page authors:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/pages/[id]/authors - Add a new author to a page
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: pageId } = await params
    const body = await request.json()
    
    const validatedData = addAuthorSchema.parse(body)

    // Verify the user has access to this page
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })

    if (!page) {
      return NextResponse.json(
        { error: 'Page not found or you do not have permission to add authors' },
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
    const existingAuthor = await prisma.pageAuthor.findFirst({
      where: {
        pageId,
        userId: userToAdd.id
      }
    })

    if (existingAuthor) {
      return NextResponse.json(
        { error: 'User is already an author of this page' },
        { status: 400 }
      )
    }

    // Add the new author
    const newAuthor = await prisma.pageAuthor.create({
      data: {
        pageId,
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

    console.error('Error adding page author:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 