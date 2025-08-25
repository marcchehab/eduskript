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
      console.log('Unauthorized: no session or user ID')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { skriptIds } = body

    console.log(`Collection reorder request - ID: ${id}, User: ${session.user.id}, SkriptIds:`, skriptIds)

    if (!Array.isArray(skriptIds)) {
      console.log('Invalid request: skriptIds is not an array')
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
        collectionSkripts: {
          include: {
            skript: true
          }
        }
      }
    })

    if (!collection) {
      console.log(`Collection not found or user ${session.user.id} doesn't have access to collection ${id}`)
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      )
    }

    console.log(`Found collection: ${collection.title} with ${collection.collectionSkripts.length} skripts`)

    // Verify all skript IDs belong to this collection
    const collectionSkriptIds = collection.collectionSkripts.map((cs) => cs.skript.id)
    const allSkriptIdsValid = skriptIds.every((id: string) => collectionSkriptIds.includes(id))
    
    console.log('Collection skript IDs:', collectionSkriptIds)
    console.log('Provided skript IDs:', skriptIds)
    console.log('All IDs valid:', allSkriptIdsValid)
    console.log('Length match:', skriptIds.length === collection.collectionSkripts.length)
    
    if (!allSkriptIdsValid || skriptIds.length !== collection.collectionSkripts.length) {
      console.log('Invalid skript IDs provided - validation failed')
      return NextResponse.json(
        { error: 'Invalid skript IDs provided' },
        { status: 400 }
      )
    }

    // Update skript orders in junction table
    console.log('Starting transaction to update skript orders in junction table')
    const updates = skriptIds.map((skriptId: string, index: number) => {
      console.log(`Updating skript ${skriptId} to order ${index} in collection ${id}`)
      return prisma.collectionSkript.update({
        where: {
          collectionId_skriptId: {
            collectionId: id,
            skriptId: skriptId
          }
        },
        data: { order: index }
      })
    })

    await prisma.$transaction(updates)
    console.log('Transaction completed successfully')
    
    // Verify the update worked
    const verifyCollection = await prisma.collection.findFirst({
      where: { id },
      include: {
        collectionSkripts: {
          orderBy: { order: 'asc' },
          include: {
            skript: {
              select: {
                id: true,
                title: true
              }
            }
          }
        }
      }
    })
    
    console.log('Verification - Updated orders:', verifyCollection?.collectionSkripts.map(cs => ({
      skriptId: cs.skriptId,
      title: cs.skript.title,
      order: cs.order
    })))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error reordering skripts:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 