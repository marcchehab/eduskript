import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCollectionPermissions } from '@/lib/permissions'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const collection = await prisma.collection.findUnique({
      where: { id },
      include: {
        skripts: {
          include: {
            pages: {
              orderBy: { order: 'asc' }
            }
          },
          orderBy: { order: 'asc' }
        },
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    // Check if user has permission to view this collection
    const permissions = checkCollectionPermissions(session.user.id, collection.authors)
    if (!permissions.canView) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json({ 
      success: true, 
      data: collection, 
      permissions,
      title: collection.title,
      description: collection.description
    })
  } catch (error) {
    console.error('Error fetching collection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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
    const { title, description, isPublished } = await request.json()

    // Get collection with authors to check permissions
    const existingCollection = await prisma.collection.findUnique({
      where: { id },
      include: {
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    if (!existingCollection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    // Check if user can edit this collection
    const permissions = checkCollectionPermissions(session.user.id, existingCollection.authors)
    if (!permissions.canEdit) {
      return NextResponse.json({ error: 'You do not have permission to edit this collection' }, { status: 403 })
    }

    const collection = await prisma.collection.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(isPublished !== undefined && { isPublished })
      },
      include: {
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    return NextResponse.json(collection)
  } catch (error) {
    console.error('Error updating collection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Get collection with authors to check permissions
    const existingCollection = await prisma.collection.findUnique({
      where: { id },
      include: {
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    if (!existingCollection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    // Check if user can edit (delete) this collection
    const permissions = checkCollectionPermissions(session.user.id, existingCollection.authors)
    if (!permissions.canEdit) {
      return NextResponse.json({ error: 'You do not have permission to delete this collection' }, { status: 403 })
    }

    await prisma.collection.delete({
      where: { id }
    })

    return NextResponse.json({ message: 'Collection deleted successfully' })
  } catch (error) {
    console.error('Error deleting collection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 