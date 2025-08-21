import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Send a collaboration request
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { receiverId, message } = await request.json()

    // Validate input
    if (!receiverId) {
      return NextResponse.json(
        { error: 'Receiver ID is required' },
        { status: 400 }
      )
    }

    // Can't send request to yourself
    if (receiverId === session.user.id) {
      return NextResponse.json(
        { error: 'Cannot send collaboration request to yourself' },
        { status: 400 }
      )
    }

    // Check if receiver exists
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId }
    })

    if (!receiver) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Check if collaboration already exists
    const existingCollaboration = await prisma.collaboration.findFirst({
      where: {
        OR: [
          { requesterId: session.user.id, receiverId },
          { requesterId: receiverId, receiverId: session.user.id }
        ]
      }
    })

    if (existingCollaboration) {
      return NextResponse.json(
        { error: 'You are already collaborators' },
        { status: 409 }
      )
    }

    // Check if request already exists
    const existingRequest = await prisma.collaborationRequest.findFirst({
      where: {
        OR: [
          { requesterId: session.user.id, receiverId, status: 'pending' },
          { requesterId: receiverId, receiverId: session.user.id, status: 'pending' }
        ]
      }
    })

    if (existingRequest) {
      return NextResponse.json(
        { error: 'Collaboration request already exists' },
        { status: 409 }
      )
    }

    // Create collaboration request
    const collaborationRequest = await prisma.collaborationRequest.create({
      data: {
        requesterId: session.user.id,
        receiverId,
        message: message || null
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

    return NextResponse.json({ success: true, data: collaborationRequest })
  } catch (error) {
    console.error('Error sending collaboration request:', error)
    return NextResponse.json(
      { error: 'Failed to send collaboration request' },
      { status: 500 }
    )
  }
}

// Get collaboration requests (both sent and received)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get sent requests
    const sentRequests = await prisma.collaborationRequest.findMany({
      where: {
        requesterId: session.user.id,
        status: 'pending'
      },
      include: {
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Get received requests
    const receivedRequests = await prisma.collaborationRequest.findMany({
      where: {
        receiverId: session.user.id,
        status: 'pending'
      },
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Get existing collaborations
    const collaborations = await prisma.collaboration.findMany({
      where: {
        OR: [
          { requesterId: session.user.id },
          { receiverId: session.user.id }
        ]
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
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ 
      success: true, 
      data: {
        sentRequests,
        receivedRequests,
        collaborations
      }
    })
  } catch (error) {
    console.error('Error fetching collaboration requests:', error)
    return NextResponse.json(
      { error: 'Failed to fetch collaboration requests' },
      { status: 500 }
    )
  }
}