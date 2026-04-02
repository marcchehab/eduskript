import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface PythonCheckData {
  checksUsed: number
  maxChecks: number | null
  points: number
  earnedPoints: number
  lastResults: { index: number; passed: boolean; label: string; error?: string }[]
  lastCheckedAt: number
}

// GET /api/classes/[id]/python-responses?pageId=X&componentId=Y
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

    // Fetch stored check results
    const records = await prisma.userData.findMany({
      where: { userId: { in: studentIds }, adapter: componentId, itemId: pageId },
      select: { userId: true, data: true, updatedAt: true }
    })

    const recordMap = new Map(
      records.map(r => [r.userId, { data: r.data as unknown as PythonCheckData, updatedAt: r.updatedAt }])
    )

    let fullPass = 0
    let partialPass = 0
    let failed = 0
    let notAttempted = 0
    let totalScore = 0
    let attemptedCount = 0

    const responseItems = memberships.map(m => {
      const record = recordMap.get(m.student.id)
      const data = record?.data

      if (!data || !data.lastResults || data.lastResults.length === 0) {
        notAttempted++
        return {
          studentId: m.student.id,
          displayName: m.student.name ?? `Student ${(m.student.studentPseudonym ?? '').slice(0, 6)}`,
          testsPassed: null,
          totalTests: null,
          earnedPoints: null,
          submittedAt: record?.updatedAt ? record.updatedAt.getTime() : null,
        }
      }

      const testsPassed = data.lastResults.filter(r => r.passed).length
      const totalTests = data.lastResults.length
      const percentage = totalTests > 0 ? (testsPassed / totalTests) * 100 : 0

      attemptedCount++
      totalScore += percentage

      if (testsPassed === totalTests) fullPass++
      else if (testsPassed > 0) partialPass++
      else failed++

      return {
        studentId: m.student.id,
        displayName: m.student.name ?? `Student ${(m.student.studentPseudonym ?? '').slice(0, 6)}`,
        testsPassed,
        totalTests,
        earnedPoints: data.earnedPoints,
        submittedAt: record?.updatedAt ? record.updatedAt.getTime() : null,
      }
    })

    const stats = {
      fullPass,
      partialPass,
      failed,
      notAttempted,
      total: memberships.length,
      averageScore: attemptedCount > 0 ? totalScore / attemptedCount : 0,
    }

    return NextResponse.json({ stats, responses: responseItems })
  } catch (error) {
    console.error('[API] Error fetching Python responses:', error)
    return NextResponse.json({ error: 'Failed to fetch Python responses' }, { status: 500 })
  }
}
