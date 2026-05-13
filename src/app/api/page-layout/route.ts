import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const pageLayout = await prisma.pageLayout.findUnique({
      where: { userId: session.user.id },
      include: {
        items: {
          orderBy: { order: 'asc' }
        }
      }
    })

    return NextResponse.json({ 
      success: true, 
      data: pageLayout || { items: [] }
    })
  } catch (error) {
    console.error('Error fetching page layout:', error)
    return NextResponse.json(
      { error: 'Failed to fetch page layout' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { items } = await request.json()

    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Items must be an array' },
        { status: 400 }
      )
    }

    // SECURITY: Validate that user has permission to access each item
    const validatedItems: Array<{ id: string; type: string }> = []

    for (const item of items) {
      if (!item.id || !item.type) {
        continue // Skip invalid items
      }

      if (item.type === 'collection') {
        // Check if user has any permission on this collection
        const collection = await prisma.collection.findFirst({
          where: {
            id: item.id,
            authors: {
              some: {
                userId: session.user.id
              }
            }
          }
        })

        if (collection) {
          validatedItems.push(item)
        } else {
          console.warn(`[Page Layout] User ${session.user.email} attempted to add collection ${item.id} without permission`)
        }
      } else if (item.type === 'skript') {
        // Check if user has any permission on this skript
        const skript = await prisma.skript.findFirst({
          where: {
            id: item.id,
            authors: {
              some: {
                userId: session.user.id
              }
            }
          }
        })

        if (skript) {
          validatedItems.push(item)
        } else {
          console.warn(`[Page Layout] User ${session.user.email} attempted to add skript ${item.id} without permission`)
        }
      }
    }

    // Upsert page layout with only validated items
    const pageLayout = await prisma.pageLayout.upsert({
      where: { userId: session.user.id },
      update: {
        items: {
          deleteMany: {},
          create: validatedItems.map((item, index) => ({
            type: item.type,
            contentId: item.id,
            order: index
          }))
        }
      },
      create: {
        userId: session.user.id,
        items: {
          create: validatedItems.map((item, index) => ({
            type: item.type,
            contentId: item.id,
            order: index
          }))
        }
      },
      include: {
        items: {
          orderBy: { order: 'asc' }
        }
      }
    })

    // The public sidebar reads page-layout items through two cached queries
    // (getTeacherWithLayout + getTeacherHomepageContent). Both are tagged with
    // teacherContent and user; without these invalidations a root-promoted
    // skript stays invisible on the live site until the tag is bumped elsewhere.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pageSlug: true }
    })
    if (user?.pageSlug) {
      revalidateTag(CACHE_TAGS.teacherContent(user.pageSlug), { expire: 0 })
      revalidateTag(CACHE_TAGS.user(user.pageSlug), { expire: 0 })
    }

    return NextResponse.json({ success: true, data: pageLayout })
  } catch (error) {
    console.error('Error saving page layout:', error)
    return NextResponse.json(
      { error: 'Failed to save page layout' },
      { status: 500 }
    )
  }
}