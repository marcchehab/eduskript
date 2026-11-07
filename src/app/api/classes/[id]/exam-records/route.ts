/**
 * The archived exams (ExamRecord, src/lib/exam-records.ts) filed under one
 * class, without their payloads. Class owner only; works for archived and
 * active classes (records are written on every return).
 *
 * GET /api/classes/[id]/exam-records
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const cls = await prisma.class.findUnique({ where: { id }, select: { teacherId: true } })
  if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 })
  if (cls.teacherId !== session.user.id) {
    return NextResponse.json({ error: 'You do not have permission to view this class' }, { status: 403 })
  }

  const records = await prisma.examRecord.findMany({
    where: { classId: id },
    select: {
      id: true, pageId: true, pageTitle: true, studentId: true, studentName: true, studentPseudonym: true,
      studentEmail: true, submittedAt: true, returnedAt: true, score: true, maxScore: true, grade: true, retainUntil: true,
    },
    orderBy: [{ pageTitle: 'asc' }, { studentName: 'asc' }],
  })
  return NextResponse.json({ records })
}
