import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// DELETE /api/pages/[id]/authors/[userId] - Remove an author from a page
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: pageId, userId } = await params

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
          select: {
            userId: true
          }
        }
      }
    })

    if (!page) {
      return NextResponse.json(
        { error: 'Page not found or you do not have permission to remove authors' },
        { status: 404 }
      )
    }

    // Check if the user to remove is actually an author
    const authorToRemove = await prisma.pageAuthor.findFirst({
      where: {
        pageId,
        userId
      }
    })

    if (!authorToRemove) {
      return NextResponse.json(
        { error: 'User is not an author of this page' },
        { status: 404 }
      )
    }

    // Prevent removing yourself if you're the only author
    if (userId === session.user.id && page.authors.length === 1) {
      return NextResponse.json(
        { error: 'Cannot remove yourself as the only author. Add another author first.' },
        { status: 400 }
      )
    }

    // Remove the author
    await prisma.pageAuthor.delete({
      where: {
        id: authorToRemove.id
      }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error removing page author:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 