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
    const { skriptIds } = body

    if (!Array.isArray(skriptIds)) {
      return NextResponse.json(
        { error: 'skriptIds must be an array' },
        { status: 400 }
      )
    }

    // Check if collection exists and belongs to user
    const collection = await prisma.collection.findFirst({
      where: {
        id,
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        skripts: true
      }
    })

    if (!collection) {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    // Verify all skript IDs belong to this collection
    const collectionSkriptIds = collection.skripts.map((c) => c.id)
    const allSkriptIdsValid = skriptIds.every((id: string) => collectionSkriptIds.includes(id))
    
    if (!allSkriptIdsValid || skriptIds.length !== collection.skripts.length) {
      return NextResponse.json(
        { error: 'Invalid skript IDs provided' },
        { status: 400 }
      )
    }

    // Update skript orders
    const updates = skriptIds.map((skriptId: string, index: number) => 
      prisma.skript.update({
        where: { id: skriptId },
        data: { order: index + 1 }
      })
    )

    await prisma.$transaction(updates)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error reordering skripts:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 