import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{
    id: string
    studentId: string
  }>
}

/**
 * DELETE /api/classes/[id]/students/[studentId]
 *
 * Unenroll a student from a class
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId, studentId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify class exists and user owns it
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true }
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    if (classRecord.teacherId !== session.user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to manage this class' },
        { status: 403 }
      )
    }

    // Delete the class membership
    await prisma.classMembership.deleteMany({
      where: {
        classId,
        studentId
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Error unenrolling student:', error)
    return NextResponse.json(
      { error: 'Failed to unenroll student' },
      { status: 500 }
    )
  }
}
