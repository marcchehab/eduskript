import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface SqlVerificationData {
  isCorrect: boolean
  hasAttempted: boolean
}

interface SqlResponseItem {
  studentId: string
  pseudonym: string
  displayName: string
  isCorrect: boolean | null  // null = not attempted
  submittedAt: number | null
}

interface SqlStats {
  correct: number
  incorrect: number
  notAttempted: number
  total: number
}

// GET /api/classes/[id]/sql-responses?pageId=X&componentId=Y
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const pageId = searchParams.get('pageId')
    const componentId = searchParams.get('componentId')

    if (!pageId || !componentId) {
      return NextResponse.json(
        { error: 'Missing required parameters: pageId and componentId' },
        { status: 400 }
      )
    }

    // Verify class exists and caller is its teacher
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true }
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    if (classRecord.teacherId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All class members
    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      include: {
        student: { select: { id: true, name: true, studentPseudonym: true } }
      }
    })

    const studentIds = memberships.map(m => m.student.id)

    // Fetch stored verification results
    // adapter = componentId (e.g. "sql-verification-editor-abc"), itemId = pageId
    const records = await prisma.userData.findMany({
      where: { userId: { in: studentIds }, adapter: componentId, itemId: pageId },
      select: { userId: true, data: true, updatedAt: true }
    })

    const recordMap = new Map(
      records.map(r => [r.userId, { data: r.data as unknown as SqlVerificationData, updatedAt: r.updatedAt }])
    )

    const stats: SqlStats = { correct: 0, incorrect: 0, notAttempted: 0, total: memberships.length }

    const responseItems: SqlResponseItem[] = memberships.map(m => {
      const record = recordMap.get(m.student.id)
      const data = record?.data

      let isCorrect: boolean | null = null
      if (data?.hasAttempted) {
        isCorrect = data.isCorrect
        if (isCorrect) stats.correct++
        else stats.incorrect++
      } else {
        stats.notAttempted++
      }

      return {
        studentId: m.student.id,
        pseudonym: m.student.studentPseudonym ?? '',
        displayName: m.student.name ?? '—',
        isCorrect,
        submittedAt: record?.updatedAt ? record.updatedAt.getTime() : null,
      }
    })

    return NextResponse.json({ stats, responses: responseItems })
  } catch (error) {
    console.error('[API] Error fetching SQL responses:', error)
    return NextResponse.json({ error: 'Failed to fetch SQL responses' }, { status: 500 })
  }
}
