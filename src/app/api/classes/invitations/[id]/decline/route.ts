import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{
    id: string // classId
  }>
}

// POST /api/classes/invitations/[id]/decline - Decline a class invitation
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { accountType: true, studentPseudonym: true }
    })

    if (!user || user.accountType !== 'student') {
      return NextResponse.json({ error: 'Only students can decline invitations' }, { status: 403 })
    }

    if (!user.studentPseudonym) {
      return NextResponse.json({ error: 'No pseudonym found' }, { status: 400 })
    }

    // Delete the PreAuthorizedStudent record
    const deleted = await prisma.preAuthorizedStudent.deleteMany({
      where: {
        classId,
        pseudonym: user.studentPseudonym
      }
    })

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Invitation declined' })
  } catch (error) {
    console.error('[API] Error declining invitation:', error)
    return NextResponse.json({ error: 'Failed to decline invitation' }, { status: 500 })
  }
}
