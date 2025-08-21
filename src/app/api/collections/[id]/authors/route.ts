import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCollectionPermissions } from '@/lib/permissions'

// Get all authors for a collection
export async function GET(
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

    const { id } = await params

    const collection = await prisma.collection.findUnique({
      where: { id },
      include: {
        authors: {
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
        }
      }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    // Check if user has permission to view authors
    const permissions = checkCollectionPermissions(session.user.id, collection.authors)
    if (!permissions.canView) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    return NextResponse.json({ success: true, data: collection.authors })
  } catch (error) {
    console.error('Error fetching collection authors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch collection authors' },
      { status: 500 }
    )
  }
}

// Add a new author to a collection
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

    const { id } = await params
    const { userId, permission } = await request.json()

    if (!userId || !permission || !['author', 'viewer'].includes(permission)) {
      return NextResponse.json(
        { error: 'Valid userId and permission (author|viewer) are required' },
        { status: 400 }
      )
    }

    // Get collection with current authors
    const collection = await prisma.collection.findUnique({
      where: { id },
      include: {
        authors: {
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
        }
      }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    // Check if current user can manage authors
    const permissions = checkCollectionPermissions(session.user.id, collection.authors)
    if (!permissions.canManageAuthors) {
      return NextResponse.json(
        { error: 'You do not have permission to manage authors for this collection' },
        { status: 403 }
      )
    }

    // Check if user is already an author
    const existingAuthor = collection.authors.find(author => author.userId === userId)
    if (existingAuthor) {
      return NextResponse.json(
        { error: 'User is already an author of this collection' },
        { status: 409 }
      )
    }

    // Verify the user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        title: true
      }
    })

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Add the user as an author
    const newAuthor = await prisma.collectionAuthor.create({
      data: {
        collectionId: id,
        userId: userId,
        permission: permission
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

    return NextResponse.json({ success: true, data: newAuthor })
  } catch (error) {
    console.error('Error adding collection author:', error)
    return NextResponse.json(
      { error: 'Failed to add collection author' },
      { status: 500 }
    )
  }
}