import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'

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

    const skript = await prisma.skript.findUnique({
      where: { id },
      include: {
        collectionSkripts: {
          include: {
            collection: true
          }
        },
        pages: {
          orderBy: { order: 'asc' }
        },
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    if (!skript) {
      return NextResponse.json({ error: 'Skript not found' }, { status: 404 })
    }

    // Check if user has permission to view this skript
    const permissions = checkSkriptPermissions(session.user.id, skript.authors)
    if (!permissions.canView) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json({ 
      success: true, 
      data: skript, 
      permissions,
      title: skript.title,
      description: skript.description
    })
  } catch (error) {
    console.error('Error fetching skript:', error)
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params
    const { title, slug, description, isPublished } = await request.json()

    // Validate input - at least one field is required
    if (!title && !slug && description === undefined && isPublished === undefined) {
      return NextResponse.json(
        { error: 'At least one field is required for update' },
        { status: 400 }
      )
    }

    // Check if user is an author of this skript
    const existingSkript = await prisma.skript.findFirst({
      where: {
        id,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        collection: true
      }
    })

    if (!existingSkript) {
      return NextResponse.json(
        { error: 'Skript not found or access denied' },
        { status: 404 }
      )
    }

    // Check if slug is already used in the same collection (but not this skript)
    if (slug && slug !== existingSkript.slug) {
      const slugExists = await prisma.skript.findFirst({
        where: {
          collectionId: existingSkript.collectionId,
          slug,
          NOT: { id }
        }
      })

      if (slugExists) {
        return NextResponse.json(
          { error: 'Slug already exists in this collection' },
          { status: 409 }
        )
      }
    }

    // Update skript
    const updatedSkript = await prisma.skript.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(slug && { slug }),
        ...(description !== undefined && { description }),
        ...(isPublished !== undefined && { isPublished })
      },
      include: {
        pages: {
          orderBy: { order: 'asc' }
        },
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    // Get user's subdomain for revalidation
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (user?.subdomain) {
      // Revalidate relevant paths
      revalidatePath(`/${user.subdomain}/${existingSkript.collection.slug}/${updatedSkript.slug}`)
      revalidatePath(`/${user.subdomain}/${existingSkript.collection.slug}`)
      revalidatePath(`/${user.subdomain}`)
      revalidatePath('/dashboard')
    }

    return NextResponse.json(updatedSkript)
  } catch (error) {
    console.error('Error updating skript:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    // Check if user is an author of this skript
    const existingSkript = await prisma.skript.findFirst({
      where: {
        id,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        collection: true
      }
    })

    if (!existingSkript) {
      return NextResponse.json(
        { error: 'Skript not found or access denied' },
        { status: 404 }
      )
    }

    // Delete skript (cascading delete will handle pages)
    await prisma.skript.delete({
      where: { id }
    })

    // Get user's subdomain for revalidation
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subdomain: true }
    })

    if (user?.subdomain) {
      // Revalidate relevant paths
      revalidatePath(`/${user.subdomain}/${existingSkript.collection.slug}`)
      revalidatePath(`/${user.subdomain}`)
      revalidatePath('/dashboard')
    }

    return NextResponse.json({ message: 'Skript deleted successfully' })
  } catch (error) {
    console.error('Error deleting skript:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
