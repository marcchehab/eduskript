import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSlug } from '@/lib/markdown'

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

    // Check if slug already exists (globally, since no more user-scoped slugs)
    const existingTopic = await prisma.topic.findFirst({
      where: {
        slug: normalizedSlug,
      }
    })

    if (existingTopic) {
      return NextResponse.json(
        { error: 'A topic with this slug already exists' },
        { status: 409 }
      )
    }

    // Create topic with the current user as the first author
    const topic = await prisma.topic.create({
      data: {
        title,
        description: description || null,
        slug: normalizedSlug,
        authors: {
          create: {
            userId: session.user.id,
            role: "author"
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

    return NextResponse.json({ success: true, data: topic })
  } catch (error) {
    console.error('Error creating topic:', error)
    return NextResponse.json(
      { error: 'Failed to create topic' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get topics where the user is an author
    const topics = await prisma.topic.findMany({
      where: {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        chapters: {
          include: {
            pages: true
          }
        },
        authors: {
          include: {
            user: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    })

    return NextResponse.json({ success: true, data: topics })
  } catch (error) {
    console.error('Error fetching topics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch topics' },
      { status: 500 }
    )
  }
} 