import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateInviteCode } from '@/lib/invite-code'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { eventBus } from '@/lib/events'
import { archiveClassExams } from '@/lib/exam-records'

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
      select: { teacherId: true, lockdownMode: true }
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
    const { name, description, allowAnonymous, nicknameLogin, lockdownMode, archived, shortInviteCode } = body

    // Build update data
    const updateData: {
      name?: string
      description?: string | null
      allowAnonymous?: boolean
      nicknameLogin?: boolean
      lockdownMode?: boolean
      archivedAt?: Date | null
      inviteCode?: string
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
      // Nickname login is a way of joining anonymously (src/lib/nickname-login.ts).
      if (!updateData.allowAnonymous) updateData.nicknameLogin = false
    }

    if (nicknameLogin !== undefined && updateData.nicknameLogin === undefined) {
      updateData.nicknameLogin = nicknameLogin === true
      if (updateData.nicknameLogin) updateData.allowAnonymous = true
    }

    // Replace an older 16-character code with a short one. The old invite
    // link stops working. A collision with another class's code (31^6 codes)
    // is not retried: the update fails with 500 and the teacher clicks again.
    if (shortInviteCode === true) {
      updateData.inviteCode = generateInviteCode()
    }

    if (lockdownMode !== undefined) {
      updateData.lockdownMode = lockdownMode === true
    }

    // Archive (src/lib/exam-records.ts): copy the members' exams first, so a
    // failed copy leaves the class active. Also ends lockdown and closes its
    // open exams; the exam state route refuses to reopen them while archived.
    // Open exam tabs learn of the close only on their next state fetch.
    let archivedExams: number | undefined
    if (archived === true) {
      archivedExams = await archiveClassExams(id, session.user.id)
      updateData.archivedAt = new Date()
      updateData.lockdownMode = false
      await prisma.examState.updateMany({
        where: { classId: id, state: { in: ['open', 'lobby'] } },
        data: { state: 'closed', closedAt: updateData.archivedAt },
      })
    } else if (archived === false) {
      updateData.archivedAt = null
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

    // Lockdown flipped → tell every member's open tab to reload so it re-hits the
    // middleware gate (locked → SEB-required screen; unlocked → normal content).
    // Fire-and-forget: a missed event just means the student reloads manually.
    if (updateData.lockdownMode !== undefined && updateData.lockdownMode !== existingClass.lockdownMode) {
      void eventBus.publish(`lockdown:${id}`, {
        type: 'lockdown-change',
        classId: id,
        locked: updateData.lockdownMode,
        timestamp: Date.now(),
      }).catch((err) => console.error('[API] Failed to publish lockdown change:', err))
    }

    return NextResponse.json({
      class: {
        id: updatedClass.id,
        name: updatedClass.name,
        description: updatedClass.description,
        inviteCode: updatedClass.inviteCode,
        allowAnonymous: updatedClass.allowAnonymous,
        nicknameLogin: updatedClass.nicknameLogin,
        lockdownMode: updatedClass.lockdownMode,
        archivedAt: updatedClass.archivedAt,
        memberCount: updatedClass._count.memberships,
        preAuthorizedCount: updatedClass._count.preAuthorizedStudents,
        createdAt: updatedClass.createdAt,
        updatedAt: updatedClass.updatedAt
      },
      ...(archivedExams !== undefined && { archivedExams }),
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
