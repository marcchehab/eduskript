import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSlug, isReservedSlug } from '@/lib/markdown'
import { checkCollectionPermissions } from '@/lib/permissions'
import { listSkriptsForUser } from '@/lib/services/skripts'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { title, description, slug, collectionId } = await request.json()

    // Validate input
    if (!title || !slug || !collectionId) {
      return NextResponse.json(
        { error: 'Title, slug, and collection ID are required' },
        { status: 400 }
      )
    }

    // Verify the user can edit the collection
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        authors: {
          include: {
            user: true
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

    const permissions = checkCollectionPermissions(session.user.id, collection.authors)
    if (!permissions.canEdit) {
      return NextResponse.json(
        { error: 'You do not have permission to create skripts in this collection' },
        { status: 403 }
      )
    }

    // Normalize slug
    const normalizedSlug = generateSlug(slug)

    // Check for reserved slugs that conflict with system routes
    if (isReservedSlug(normalizedSlug)) {
      return NextResponse.json(
        { error: `The slug "${normalizedSlug}" is reserved and cannot be used` },
        { status: 400 }
      )
    }

    // Check slug uniqueness scoped to this user's skripts
    const existingSkript = await prisma.skript.findFirst({
      where: {
        slug: normalizedSlug,
        OR: [
          { authors: { some: { userId: session.user.id } } },
          { collectionSkripts: { some: { collection: { authors: { some: { userId: session.user.id } } } } } }
        ]
      }
    })

    if (existingSkript) {
      return NextResponse.json(
        { error: `You already have a skript with the slug "${normalizedSlug}"` },
        { status: 409 }
      )
    }

    // Get the next order number for skripts in this collection
    const lastCollectionSkript = await prisma.collectionSkript.findFirst({
      where: { collectionId },
      orderBy: { order: 'desc' }
    })

    const nextOrder = (lastCollectionSkript?.order ?? -1) + 1

    // Create skript and add to collection via junction table
    const skript = await prisma.$transaction(async (tx) => {
      // Create the skript
      const newSkript = await tx.skript.create({
        data: {
          title,
          description,
          slug: normalizedSlug,
          authors: {
            create: {
              userId: session.user.id,
              permission: "author"
            }
          }
        }
      })

      // Add to collection via junction table
      await tx.collectionSkript.create({
        data: {
          collectionId,
          skriptId: newSkript.id,
          order: nextOrder
        }
      })

      return newSkript
    })

    // Fetch the created skript with all relations
    const createdSkriptWithRelations = await prisma.skript.findUnique({
      where: { id: skript.id },
      include: {
        authors: {
          include: {
            user: true
          }
        },
        collectionSkripts: {
          include: {
            collection: true
          }
        }
      }
    })

    revalidatePath('/dashboard')
    return NextResponse.json(createdSkriptWithRelations)
  } catch (error) {
    console.error('Error creating skript:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const includeShared = searchParams.get('includeShared') === 'true'

    const skripts = await listSkriptsForUser(session.user.id, { includeShared })

    return NextResponse.json({ success: true, data: skripts })
  } catch (error) {
    console.error('Error fetching skripts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch skripts' },
      { status: 500 }
    )
  }
}
