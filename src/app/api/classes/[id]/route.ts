import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'

// PATCH /api/classes/[id] - Update a class
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isPaidUser(session.user)) {
      return paidOnlyResponse('Class management is a paid feature.')
    }

    const { id } = await params

    // Verify user owns this class
    const existingClass = await prisma.class.findUnique({
      where: { id },
      select: { teacherId: true }
    })

    if (!existingClass) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    if (existingClass.teacherId !== session.user.id) {
      return NextResponse.json(
        { error: 'Only the class owner can update it' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name, description, allowAnonymous } = body

    // Build update data
    const updateData: {
      name?: string
      description?: string | null
      allowAnonymous?: boolean
    } = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'Class name cannot be empty' }, { status: 400 })
      }
      updateData.name = name.trim()
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null
    }

    if (allowAnonymous !== undefined) {
      updateData.allowAnonymous = allowAnonymous === true
    }

    // Update the class
    const updatedClass = await prisma.class.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: {
            memberships: true,
            preAuthorizedStudents: true
          }
        }
      }
    })

    return NextResponse.json({
      class: {
        id: updatedClass.id,
        name: updatedClass.name,
        description: updatedClass.description,
        inviteCode: updatedClass.inviteCode,
        allowAnonymous: updatedClass.allowAnonymous,
        memberCount: updatedClass._count.memberships,
        preAuthorizedCount: updatedClass._count.preAuthorizedStudents,
        createdAt: updatedClass.createdAt,
        updatedAt: updatedClass.updatedAt
      }
    })
  } catch (error) {
    console.error('[API] Error updating class:', error)
    return NextResponse.json({ error: 'Failed to update class' }, { status: 500 })
  }
}

// DELETE /api/classes/[id] - Delete a class (soft delete by setting isActive = false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Verify user owns this class
    const existingClass = await prisma.class.findUnique({
      where: { id },
      select: { teacherId: true }
    })

    if (!existingClass) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    if (existingClass.teacherId !== session.user.id) {
      return NextResponse.json(
        { error: 'Only the class owner can delete it' },
        { status: 403 }
      )
    }

    // Soft delete by setting isActive = false
    await prisma.class.update({
      where: { id },
      data: { isActive: false }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Error deleting class:', error)
    return NextResponse.json({ error: 'Failed to delete class' }, { status: 500 })
  }
}
