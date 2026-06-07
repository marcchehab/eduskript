/**
 * Create a TEMPORARY student account for one class — a throwaway email+password
 * login a teacher hands a student on a spare laptop when their device crashes
 * mid-exam. The account is a normal `accountType:'student'` user flagged
 * `isTemporary`, enrolled in the class, with `emailVerified` pre-set so the
 * credentials provider lets it log in immediately (see src/lib/auth.ts).
 *
 * Afterwards the teacher transfers its answers to the student's real account
 * (POST /api/teacher/temp-users/[sourceId]/transfer).
 *
 * POST /api/classes/[id]/temp-user   body: { email?, password? }
 *   Teacher-only, must own the class. email/password are generated when omitted.
 *   Returns { userId, email, password, displayName } — password is returned ONCE
 *   (plaintext) so the teacher can copy it; only the bcrypt hash is stored.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { generatePseudonym, getStableStudentNickname } from '@/lib/privacy/pseudonym'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPaidUser(session.user)) return paidOnlyResponse('Temporary users are a paid feature.')

    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { teacherId: true } })
    if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    if (cls.teacherId !== session.user.id) {
      return NextResponse.json({ error: 'You do not own this class' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string }
    // Short, copy-friendly generated credentials when not supplied.
    const email = (body.email?.trim() || `examtmp-${randomBytes(4).toString('hex')}@temp.eduskript.org`).toLowerCase()
    const password = body.password?.trim() || randomBytes(6).toString('base64url').slice(0, 8)

    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return NextResponse.json({ error: 'A user with that email already exists.' }, { status: 409 })
    }

    const pseudonym = generatePseudonym(email)
    const displayName = getStableStudentNickname(pseudonym)
    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email,
          name: displayName,
          hashedPassword,
          emailVerified: new Date(), // bypass verification so credentials login works now
          accountType: 'student',
          isTemporary: true,
          studentPseudonym: pseudonym,
        },
        select: { id: true },
      })
      await tx.classMembership.create({
        // identityConsent:true — the teacher created this account, so it's not anonymous to them.
        data: { classId, studentId: u.id, identityConsent: true },
      })
      return u
    })

    return NextResponse.json({ userId: user.id, email, password, displayName })
  } catch (error) {
    console.error('[temp-user] POST failed:', error)
    return NextResponse.json({ error: 'Failed to create temporary user' }, { status: 500 })
  }
}
