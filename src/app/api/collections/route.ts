import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSlug, isReservedSlug } from '@/lib/markdown'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { title, description, slug } = await request.json()

    // Validate input
    if (!title || !slug) {
      return NextResponse.json(
        { error: 'Title and slug are required' },
        { status: 400 }
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

    // Check if slug already exists (globally, since no more user-scoped slugs)
    const existingCollection = await prisma.collection.findFirst({
      where: {
        slug: normalizedSlug,
      }
    })

    if (existingCollection) {
      return NextResponse.json(
        { error: 'A collection with this slug already exists' },
        { status: 409 }
      )
    }

    // Create collection with the current user as the first author
    const collection = await prisma.collection.create({
      data: {
        title,
        description: description || null,
        slug: normalizedSlug,
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

    return NextResponse.json({ success: true, data: collection })
  } catch (error) {
    console.error('Error creating collection:', error)
    return NextResponse.json(
      { error: 'Failed to create collection' },
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
      // Get collections where user is an author OR can view through any permission level
      whereClause = {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    } else {
      // Get only collections where the user is an author
      whereClause = {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    }

    const collections = await prisma.collection.findMany({
      where: whereClause,
      include: {
        collectionSkripts: {
          include: {
            skript: {
              include: {
                pages: true,
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
        }
      },
      orderBy: { updatedAt: 'desc' }
    })

    return NextResponse.json({ success: true, data: collections })
  } catch (error) {
    console.error('Error fetching collections:', error)
    return NextResponse.json(
      { error: 'Failed to fetch collections' },
      { status: 500 }
    )
  }
} 