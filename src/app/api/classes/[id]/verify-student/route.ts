import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyStudentEmail } from '@/lib/privacy/pseudonym'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

// POST /api/classes/[id]/verify-student - Verify if email matches pseudonym
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify class ownership
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true }
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    if (classRecord.teacherId !== session.user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to verify students in this class' },
        { status: 403 }
      )
    }

    const { email, pseudonym } = await request.json()

    if (!email || !pseudonym) {
      return NextResponse.json(
        { error: 'Both email and pseudonym are required' },
        { status: 400 }
      )
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Verify if the email matches the pseudonym
    const matches = verifyStudentEmail(pseudonym, email)

    console.log('[API] Student email verification:', {
      classId,
      teacherId: session.user.id,
      matches,
      // Don't log actual email or pseudonym for privacy
    })

    return NextResponse.json({ matches })
  } catch (error) {
    console.error('[API] Error verifying student:', error)
    return NextResponse.json(
      { error: 'Failed to verify student' },
      { status: 500 }
    )
  }
}
