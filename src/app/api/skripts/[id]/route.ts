import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { CACHE_TAGS } from '@/lib/cached-queries'

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
    // First check direct skript permissions
    let permissions = checkSkriptPermissions(session.user.id, skript.authors, undefined, session.user.isAdmin)

    // If no direct permission, check collection-level permissions
    // According to permission model: "Collection authors can view all skripts in their collections"
    // Note: Collection-level access only grants VIEW permission, not EDIT
    if (!permissions.canView && skript.collectionSkripts.length > 0) {
      for (const cs of skript.collectionSkripts) {
        if (cs.collection) {
          // Fetch collection authors
          const collection = await prisma.collection.findUnique({
            where: { id: cs.collection.id },
            include: {
              authors: {
                where: { userId: session.user.id }
              }
            }
          })

          if (collection && collection.authors.length > 0) {
            // Collection-level access grants VIEW permission only (not EDIT)
            // User needs explicit skript-level "author" permission to edit
            permissions = {
              canView: true,
              canEdit: false,
              canManageAuthors: false
            }
            break
          }
        }
      }
    }

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
    const { title, slug, description, isPublished, isUnlisted } = await request.json()

    // Validate input - at least one field is required
    if (!title && !slug && description === undefined && isPublished === undefined && isUnlisted === undefined) {
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
        collectionSkripts: {
          include: {
            collection: true
          }
        }
      }
    })

    if (!existingSkript) {
      return NextResponse.json(
        { error: 'Skript not found or access denied' },
        { status: 404 }
      )
    }

    // Check if slug is already used by another of this user's skripts
    if (slug && slug !== existingSkript.slug) {
      const slugExists = await prisma.skript.findFirst({
        where: {
          slug,
          NOT: { id },
          OR: [
            { authors: { some: { userId: session.user.id } } },
            { collectionSkripts: { some: { collection: { authors: { some: { userId: session.user.id } } } } } }
          ]
        }
      })

      if (slugExists) {
        return NextResponse.json(
          { error: 'You already have a skript with this slug' },
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
        ...(isPublished !== undefined && { isPublished }),
        ...(isUnlisted !== undefined && { isUnlisted })
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

    // Get user's username for revalidation
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true }
    })

    if (user?.pageSlug) {
      // Invalidate cached data using tags
      revalidateTag(CACHE_TAGS.skriptBySlug(user.pageSlug, updatedSkript.slug), { expire: 0 })
      for (const cs of existingSkript.collectionSkripts) {
        if (cs.collection) {
          revalidateTag(CACHE_TAGS.collectionBySlug(user.pageSlug, cs.collection.slug), { expire: 0 })
        }
      }
      // Invalidate teacher content cache (homepage, sidebar)
      revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })
      revalidatePath(`/${user.pageSlug}/${updatedSkript.slug}`)
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
        collectionSkripts: {
          include: {
            collection: true
          }
        }
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

    // Get user's username for revalidation
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true }
    })

    if (user?.pageSlug) {
      // Invalidate cached data using tags
      for (const cs of existingSkript.collectionSkripts) {
        if (cs.collection) {
          // Invalidate collection-level cache (skript was removed)
          revalidateTag(CACHE_TAGS.collectionBySlug(user.pageSlug, cs.collection.slug), { expire: 0 })
        }
      }
      // Invalidate teacher content cache (homepage, sidebar)
      revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })
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
