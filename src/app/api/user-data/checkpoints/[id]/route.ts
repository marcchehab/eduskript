/**
 * Single checkpoint fetch — returns the full payload.
 *
 * GET /api/user-data/checkpoints/[id]
 *
 * Authorization mirrors the list endpoint: caller can read their own
 * checkpoints, or a teacher can read a student's checkpoint if they teach a
 * class containing that student and the page is unlocked for that class.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { examClassActivityWhere } from '@/lib/exam-state'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const checkpoint = await prisma.userDataCheckpoint.findUnique({
      where: { id },
    })
    if (!checkpoint) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (checkpoint.userId !== session.user.id) {
      const allowed = await isTeacherOfStudentForPage(
        session.user.id,
        checkpoint.userId,
        checkpoint.pageId
      )
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    return NextResponse.json({ checkpoint })
  } catch (error) {
    console.error('[checkpoints/:id] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch checkpoint' }, { status: 500 })
  }
}

async function isTeacherOfStudentForPage(
  viewerId: string,
  studentId: string,
  pageId: string
): Promise<boolean> {
  const membership = await prisma.classMembership.findFirst({
    where: {
      studentId,
      class: {
        teacherId: viewerId,
        ...examClassActivityWhere(pageId),
      },
    },
    select: { id: true },
  })
  return Boolean(membership)
}
