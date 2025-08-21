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

    const { title, slug, content, skriptId } = await request.json()

    if (!title || !slug || !skriptId) {
      return NextResponse.json(
        { error: 'Title, slug, and skript ID are required' },
        { status: 400 }
      )
    }

    // Check if user is an author of the skript
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
        collection: {
          select: { slug: true }
        }
      }
    })

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found or access denied' },
        { status: 404 }
      )
    }

    // Check if slug already exists in this skript
    const existingPage = await prisma.page.findFirst({
      where: {
        skriptId,
        slug: generateSlug(slug)
      }
    })

    if (existingPage) {
      return NextResponse.json(
        { error: 'A page with this slug already exists in this skript' },
        { status: 409 }
      )
    }

    // Get next order
    const lastPage = await prisma.page.findFirst({
      where: { skriptId },
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
        skriptId,
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
