/**
 * One archived exam (ExamRecord, src/lib/exam-records.ts) with its payload.
 * The teacher who last returned or archived it, or the owner of its class
 * (while that class exists): the record has no foreign keys.
 *
 * GET /api/exam-records/[id]             → JSON
 * GET /api/exam-records/[id]?download=1  → same JSON as a file download
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const record = await prisma.examRecord.findUnique({ where: { id } })
  const allowed = !!record && (
    record.teacherId === session.user.id ||
    (!!record.classId && !!(await prisma.class.findFirst({ where: { id: record.classId, teacherId: session.user.id }, select: { id: true } })))
  )
  if (!record || !allowed) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (new URL(request.url).searchParams.get('download') === '1') {
    const name = `${record.pageTitle}-${record.studentName ?? record.studentPseudonym ?? record.studentId}`
      .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    return new NextResponse(JSON.stringify(record, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.json`,
      },
    })
  }
  return NextResponse.json({ record })
}
