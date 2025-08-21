import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const updatePermissionSchema = z.object({
  permission: z.enum(['author', 'viewer'], { required_error: 'Permission must be author or viewer' })
})

// PATCH /api/skripts/[id]/authors/[userId] - Update an author's permission
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: skriptId, userId } = await params
    const body = await request.json()
    const validatedData = updatePermissionSchema.parse(body)

    // Verify the user has access to manage this skript
    const skript = await prisma.skript.findFirst({
      where: {
        id: skriptId,
        authors: {
          some: {
            userId: session.user.id,
            permission: 'author' // Only authors can manage permissions
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found or you do not have permission to manage authors' },
        { status: 404 }
      )
    }

    // Check if the user is actually an author
    const authorToUpdate = await prisma.skriptAuthor.findFirst({
      where: {
        skriptId,
        userId
      }
    })

    if (!authorToUpdate) {
      return NextResponse.json(
        { error: 'User is not an author of this skript' },
        { status: 404 }
      )
    }

    // Update the permission
    const updatedAuthor = await prisma.skriptAuthor.update({
      where: {
        id: authorToUpdate.id
      },
      data: {
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

    return NextResponse.json({ success: true, data: updatedAuthor })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error updating skript author permission:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/skripts/[id]/authors/[userId] - Remove an author from a skript
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: skriptId, userId } = await params

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
          select: {
            userId: true
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found or you do not have permission to remove authors' },
        { status: 404 }
      )
    }

    // Check if the user to remove is actually an author
    const authorToRemove = await prisma.skriptAuthor.findFirst({
      where: {
        skriptId,
        userId
      }
    })

    if (!authorToRemove) {
      return NextResponse.json(
        { error: 'User is not an author of this skript' },
        { status: 404 }
      )
    }

    // Prevent removing yourself if you're the only author
    if (userId === session.user.id && skript.authors.length === 1) {
      return NextResponse.json(
        { error: 'Cannot remove yourself as the only author. Add another author first.' },
        { status: 400 }
      )
    }

    // Remove the author
    await prisma.skriptAuthor.delete({
      where: {
        id: authorToRemove.id
      }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error removing skript author:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 