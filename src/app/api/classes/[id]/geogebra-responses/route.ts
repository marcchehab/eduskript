import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ id: string }>
}

// Stored per student by the <geogebra> component (userData adapter=componentId).
interface GeogebraData {
  correct?: boolean
  hasAttempted?: boolean
}

interface GeogebraResponseItem {
  studentId: string
  displayName: string
  isCorrect: boolean | null // null = not attempted
  submittedAt: number | null
}

interface GeogebraStats {
  correct: number
  incorrect: number
  notAttempted: number
  total: number
}

// GET /api/classes/[id]/geogebra-responses?pageId=X&componentId=Y
// Class-wide tally of how many students got a GeoGebra exercise right. Mirrors
// the sql-responses endpoint; correctness comes from the `correct` boolean the
// component captures from the construction (a teacher-defined boolean object).
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

    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      include: {
        student: { select: { id: true, name: true, studentPseudonym: true } }
      }
    })

    const studentIds = memberships.map(m => m.student.id)

    const records = await prisma.userData.findMany({
      where: { userId: { in: studentIds }, adapter: componentId, itemId: pageId },
      select: { userId: true, data: true, updatedAt: true }
    })

    const recordMap = new Map(
      records.map(r => [r.userId, { data: r.data as unknown as GeogebraData, updatedAt: r.updatedAt }])
    )

    const stats: GeogebraStats = { correct: 0, incorrect: 0, notAttempted: 0, total: memberships.length }

    const responseItems: GeogebraResponseItem[] = memberships.map(m => {
      const record = recordMap.get(m.student.id)
      const data = record?.data

      let isCorrect: boolean | null = null
      if (data?.hasAttempted) {
        isCorrect = data.correct === true
        if (isCorrect) stats.correct++
        else stats.incorrect++
      } else {
        stats.notAttempted++
      }

      return {
        studentId: m.student.id,
        displayName: m.student.name ?? '—',
        isCorrect,
        submittedAt: record?.updatedAt ? record.updatedAt.getTime() : null,
      }
    })

    return NextResponse.json({ stats, responses: responseItems })
  } catch (error) {
    console.error('[API] Error fetching GeoGebra responses:', error)
    return NextResponse.json({ error: 'Failed to fetch GeoGebra responses' }, { status: 500 })
  }
}
