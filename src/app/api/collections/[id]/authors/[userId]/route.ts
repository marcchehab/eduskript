import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCollectionPermissions, canRemoveSelfAsAuthor } from '@/lib/permissions'

// Update an author's permission
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id, userId } = await params
    const { permission } = await request.json()

    if (!permission || !['author', 'viewer'].includes(permission)) {
      return NextResponse.json(
        { error: 'Valid permission (author|viewer) is required' },
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

    // Find the author to update
    const authorToUpdate = collection.authors.find(author => author.userId === userId)
    if (!authorToUpdate) {
      return NextResponse.json(
        { error: 'Author not found' },
        { status: 404 }
      )
    }

    // If trying to demote the last author, prevent it
    if (authorToUpdate.permission === 'author' && permission === 'viewer') {
      const authorCount = collection.authors.filter(author => author.permission === 'author').length
      if (authorCount === 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last author from a collection' },
          { status: 400 }
        )
      }
    }

    // Update the author's permission
    const updatedAuthor = await prisma.collectionAuthor.update({
      where: {
        collectionId_userId: {
          collectionId: id,
          userId: userId
        }
      },
      data: { permission },
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

    return NextResponse.json({ success: true, data: updatedAuthor })
  } catch (error) {
    console.error('Error updating collection author:', error)
    return NextResponse.json(
      { error: 'Failed to update collection author' },
      { status: 500 }
    )
  }
}

// Remove an author from a collection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id, userId } = await params

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

    const authorToRemove = collection.authors.find(author => author.userId === userId)
    if (!authorToRemove) {
      return NextResponse.json(
        { error: 'Author not found' },
        { status: 404 }
      )
    }

    // Check permissions
    const permissions = checkCollectionPermissions(session.user.id, collection.authors)
    const isRemovingSelf = session.user.id === userId

    if (isRemovingSelf) {
      // User can remove themselves if they're not the last author
      if (!canRemoveSelfAsAuthor(userId, collection.authors)) {
        return NextResponse.json(
          { error: 'Cannot remove yourself as the last author' },
          { status: 400 }
        )
      }
    } else {
      // User must be able to manage authors to remove others
      if (!permissions.canManageAuthors) {
        return NextResponse.json(
          { error: 'You do not have permission to remove authors from this collection' },
          { status: 403 }
        )
      }
    }

    // Remove the author
    await prisma.collectionAuthor.delete({
      where: {
        collectionId_userId: {
          collectionId: id,
          userId: userId
        }
      }
    })

    return NextResponse.json({ success: true, message: 'Author removed successfully' })
  } catch (error) {
    console.error('Error removing collection author:', error)
    return NextResponse.json(
      { error: 'Failed to remove collection author' },
      { status: 500 }
    )
  }
}