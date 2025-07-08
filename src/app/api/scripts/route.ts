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

    // Check if slug is already taken by this user
    const existingScript = await prisma.script.findUnique({
      where: {
        authorId_slug: {
          authorId: session.user.id,
          slug: normalizedSlug
        }
      }
    })

    if (existingScript) {
      return NextResponse.json(
        { error: 'A script with this slug already exists' },
        { status: 400 }
      )
    }

    // Create script
    const script = await prisma.script.create({
      data: {
        title,
        description,
        slug: normalizedSlug,
        authorId: session.user.id,
      }
    })

    return NextResponse.json(script)

  } catch (error) {
    console.error('Script creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
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

    const scripts = await prisma.script.findMany({
      where: { authorId: session.user.id },
      include: {
        chapters: {
          include: {
            pages: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    })

    return NextResponse.json(scripts)

  } catch (error) {
    console.error('Scripts fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
