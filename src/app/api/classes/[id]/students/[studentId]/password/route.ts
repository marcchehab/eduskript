import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resetNicknamePassword } from '@/lib/nickname-login'

interface RouteParams {
  params: Promise<{ id: string; studentId: string }>
}

/**
 * POST /api/classes/[id]/students/[studentId]/password
 *
 * Teacher sets a new random password for a nickname account of their class
 * (src/lib/nickname-login.ts). Returns { password } once, in plain text; only
 * the bcrypt hash is stored. Other accounts (email/OAuth) have no password here.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId, studentId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { teacherId: true } })
    if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    if (cls.teacherId !== session.user.id) {
      return NextResponse.json({ error: 'You do not have permission to manage this class' }, { status: 403 })
    }

    const student = await prisma.user.findFirst({
      where: { id: studentId, nicknameClassId: classId },
      select: { id: true },
    })
    if (!student) return NextResponse.json({ error: 'Not a nickname account of this class' }, { status: 404 })

    const password = await resetNicknamePassword(student.id)
    return NextResponse.json({ password })
  } catch (error) {
    console.error('[API] Error resetting nickname password:', error)
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
  }
}
