import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        { error: 'Search query must be at least 2 characters' },
        { status: 400 }
      )
    }

    // Get existing collaborations to filter out
    const existingCollaborations = await prisma.collaboration.findMany({
      where: {
        OR: [
          { requesterId: session.user.id },
          { receiverId: session.user.id }
        ]
      },
      select: {
        requesterId: true,
        receiverId: true
      }
    })

    // Get pending requests to filter out
    const pendingRequests = await prisma.collaborationRequest.findMany({
      where: {
        OR: [
          { requesterId: session.user.id, status: 'pending' },
          { receiverId: session.user.id, status: 'pending' }
        ]
      },
      select: {
        requesterId: true,
        receiverId: true
      }
    })

    // Create sets of user IDs to exclude
    const collaboratorIds = new Set<string>()
    const pendingUserIds = new Set<string>()

    existingCollaborations.forEach(collab => {
      if (collab.requesterId !== session.user.id) {
        collaboratorIds.add(collab.requesterId)
      }
      if (collab.receiverId !== session.user.id) {
        collaboratorIds.add(collab.receiverId)
      }
    })

    pendingRequests.forEach(request => {
      if (request.requesterId !== session.user.id) {
        pendingUserIds.add(request.requesterId)
      }
      if (request.receiverId !== session.user.id) {
        pendingUserIds.add(request.receiverId)
      }
    })

    // Search for users by name or email
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            id: {
              not: session.user.id // Exclude current user
            }
          },
          {
            OR: [
              {
                name: {
                  contains: query
                }
              },
              {
                email: {
                  contains: query
                }
              }
            ]
          }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        title: true,
        bio: true
      },
      take: 10 // Limit results
    })

    // Add status information to each user
    const usersWithStatus = users.map(user => ({
      ...user,
      relationshipStatus: collaboratorIds.has(user.id) 
        ? 'collaborator' 
        : pendingUserIds.has(user.id) 
        ? 'pending' 
        : 'none'
    }))

    return NextResponse.json({ success: true, data: usersWithStatus })
  } catch (error) {
    console.error('Error searching users:', error)
    return NextResponse.json(
      { error: 'Failed to search users' },
      { status: 500 }
    )
  }
}