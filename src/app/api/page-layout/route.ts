import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    // Upsert page layout
    const pageLayout = await prisma.pageLayout.upsert({
      where: { userId: session.user.id },
      update: {
        items: {
          deleteMany: {},
          create: items.map((item: { id: string; type: string }, index: number) => ({
            type: item.type,
            contentId: item.id,
            order: index
          }))
        }
      },
      create: {
        userId: session.user.id,
        items: {
          create: items.map((item: { id: string; type: string }, index: number) => ({
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

    return NextResponse.json({ success: true, data: pageLayout })
  } catch (error) {
    console.error('Error saving page layout:', error)
    return NextResponse.json(
      { error: 'Failed to save page layout' },
      { status: 500 }
    )
  }
}