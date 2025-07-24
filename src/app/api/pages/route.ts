import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateSlug } from '@/lib/markdown'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { title, slug, content, chapterId } = await request.json()

    if (!title || !slug || !chapterId) {
      return NextResponse.json(
        { error: 'Title, slug, and chapter ID are required' },
        { status: 400 }
      )
    }

    // Check if user is an author of the chapter
    const chapter = await prisma.chapter.findFirst({
      where: {
        id: chapterId,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        topic: {
          select: { slug: true }
        }
      }
    })

    if (!chapter) {
      return NextResponse.json(
        { error: 'Chapter not found or access denied' },
        { status: 404 }
      )
    }

    // Check if slug already exists in this chapter
    const existingPage = await prisma.page.findFirst({
      where: {
        chapterId,
        slug: generateSlug(slug)
      }
    })

    if (existingPage) {
      return NextResponse.json(
        { error: 'A page with this slug already exists in this chapter' },
        { status: 409 }
      )
    }

    // Get next order
    const lastPage = await prisma.page.findFirst({
      where: { chapterId },
      orderBy: { order: 'desc' }
    })

    const nextOrder = (lastPage?.order ?? 0) + 1

    // Create page with current user as first author
    const page = await prisma.page.create({
      data: {
        title,
        slug: generateSlug(slug),
        content: content || '',
        order: nextOrder,
        chapterId,
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

    // Create initial version
    await prisma.pageVersion.create({
      data: {
        content: content || '',
        version: 1,
        authorId: session.user.id,
        pageId: page.id
      }
    })

    revalidatePath('/dashboard')
    return NextResponse.json(page)
  } catch (error) {
    console.error('Error creating page:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
