/**
 * Rotate the teacher's exam encryption keypair.
 *
 * Flips the current active row to isActive=false (stamping rotatedAt) and
 * inserts a new active row. Old rows are kept forever so previously-
 * generated .examfile backups remain decryptable.
 *
 * Auth: NextAuth teacher session. Anyone calling without a session, or as a
 * student, is rejected.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { rotateExamKey, getOrCreateActiveExamKey } from '@/lib/exam-keys'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (session.user.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can manage exam encryption keys' },
        { status: 403 },
      )
    }

    const created = await rotateExamKey(session.user.id)
    return NextResponse.json({
      keyId: created.keyId,
      createdAt: created.createdAt,
    })
  } catch (error) {
    console.error('Error rotating exam key:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

/**
 * GET — fetch the current active key (lazy-creating if none exists). Used by
 * the rotation UI to show "current keyId / created at" alongside the rotate
 * button. Returns only public metadata; the private JWK never leaves the DB.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (session.user.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can manage exam encryption keys' },
        { status: 403 },
      )
    }

    const active = await getOrCreateActiveExamKey(session.user.id)
    return NextResponse.json({
      keyId: active.keyId,
      createdAt: active.createdAt,
    })
  } catch (error) {
    console.error('Error fetching exam key:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
