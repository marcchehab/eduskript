import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Accept or reject a collaboration request
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params
    const { action } = await request.json()

    if (!['accept', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be either "accept" or "reject"' },
        { status: 400 }
      )
    }

    // Find the collaboration request
    const collaborationRequest = await prisma.collaborationRequest.findFirst({
      where: {
        id,
        receiverId: session.user.id, // Only the receiver can respond
        status: 'pending'
      }
    })

    if (!collaborationRequest) {
      return NextResponse.json(
        { error: 'Collaboration request not found or already responded to' },
        { status: 404 }
      )
    }

    if (action === 'accept') {
      // Start a transaction to create collaboration and update request
      const result = await prisma.$transaction(async (tx) => {
        // Create collaboration
        const collaboration = await tx.collaboration.create({
          data: {
            requesterId: collaborationRequest.requesterId,
            receiverId: collaborationRequest.receiverId
          },
          include: {
            requester: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true
              }
            },
            receiver: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true
              }
            }
          }
        })

        // Update request status
        await tx.collaborationRequest.update({
          where: { id },
          data: { status: 'accepted' }
        })

        return collaboration
      })

      return NextResponse.json({ success: true, data: result })
    } else {
      // Just update the request status to rejected
      await prisma.collaborationRequest.update({
        where: { id },
        data: { status: 'rejected' }
      })

      return NextResponse.json({ success: true, message: 'Collaboration request rejected' })
    }
  } catch (error) {
    console.error('Error responding to collaboration request:', error)
    return NextResponse.json(
      { error: 'Failed to respond to collaboration request' },
      { status: 500 }
    )
  }
}

// Delete/cancel a collaboration request (only the requester can do this)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params

    // Find the collaboration request
    const collaborationRequest = await prisma.collaborationRequest.findFirst({
      where: {
        id,
        requesterId: session.user.id, // Only the requester can cancel
        status: 'pending'
      }
    })

    if (!collaborationRequest) {
      return NextResponse.json(
        { error: 'Collaboration request not found or cannot be cancelled' },
        { status: 404 }
      )
    }

    // Delete the request
    await prisma.collaborationRequest.delete({
      where: { id }
    })

    return NextResponse.json({ success: true, message: 'Collaboration request cancelled' })
  } catch (error) {
    console.error('Error cancelling collaboration request:', error)
    return NextResponse.json(
      { error: 'Failed to cancel collaboration request' },
      { status: 500 }
    )
  }
}