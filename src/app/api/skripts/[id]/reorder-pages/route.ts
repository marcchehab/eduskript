import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { pageIds } = body

    if (!Array.isArray(pageIds)) {
      return NextResponse.json(
        { error: 'pageIds must be an array' },
        { status: 400 }
      )
    }

    // Check if skript exists and belongs to user
    const skript = await prisma.skript.findFirst({
      where: {
        id,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        pages: true
      }
    })

    if (!skript) {
      return NextResponse.json(
        { error: 'Skript not found' },
        { status: 404 }
      )
    }

    // Verify all page IDs belong to this skript
    const skriptPageIds = skript.pages.map((p) => p.id)
    const allPageIdsValid = pageIds.every((id: string) => skriptPageIds.includes(id))
    
    if (!allPageIdsValid || pageIds.length !== skript.pages.length) {
      return NextResponse.json(
        { error: 'Invalid page IDs provided' },
        { status: 400 }
      )
    }

    // Update page orders
    const updates = pageIds.map((pageId: string, index: number) => 
      prisma.page.update({
        where: { id: pageId },
        data: { order: index + 1 }
      })
    )

    await prisma.$transaction(updates)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error reordering pages:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
