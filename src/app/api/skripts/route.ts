import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSlug } from '@/lib/markdown'
import { checkCollectionPermissions } from '@/lib/permissions'

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

    // Check if slug is already taken in this collection
    const existingSkript = await prisma.skript.findFirst({
      where: {
        collectionId,
        slug: normalizedSlug
      }
    })

    if (existingSkript) {
      return NextResponse.json(
        { error: 'A skript with this slug already exists in this collection' },
        { status: 409 }
      )
    }

    // Get the next order number
    const lastSkript = await prisma.skript.findFirst({
      where: { collectionId },
      orderBy: { order: 'desc' }
    })

    const nextOrder = (lastSkript?.order ?? 0) + 1

    // Create skript with the current user as the first author
    const skript = await prisma.skript.create({
      data: {
        title,
        description,
        slug: normalizedSlug,
        order: nextOrder,
        collectionId,
        authors: {
          create: {
            userId: session.user.id,
            permission: "author"
          }
        }
      },
      include: {
        authors: {
          include: {
            user: true
          }
        }
      }
    })

    revalidatePath('/dashboard')
    return NextResponse.json(skript)
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

    let whereClause
    
    if (includeShared) {
      // Get skripts where user is an author OR can view through collection/skript permissions
      whereClause = {
        OR: [
          {
            // Direct skript authorship
            authors: {
              some: {
                userId: session.user.id
              }
            }
          },
          {
            // Collection authorship (inherited permissions)
            collection: {
              authors: {
                some: {
                  userId: session.user.id
                }
              }
            }
          }
        ]
      }
    } else {
      // Get only skripts where the user is a direct author
      whereClause = {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    }

    const skripts = await prisma.skript.findMany({
      where: whereClause,
      include: {
        pages: {
          select: {
            id: true
          }
        },
        authors: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        collection: {
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
              }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    })

    return NextResponse.json({ success: true, data: skripts })
  } catch (error) {
    console.error('Error fetching skripts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch skripts' },
      { status: 500 }
    )
  }
}
