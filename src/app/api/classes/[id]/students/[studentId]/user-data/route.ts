/**
 * Student User Data API (for teachers)
 *
 * GET /api/classes/[classId]/students/[studentId]/user-data
 *   ?pageId={pageId}
 *   &adapters=annotations,code,snaps,quiz-q1
 *
 * Fetch a specific student's user data for teacher viewing.
 * Teacher must own the class that the student is enrolled in.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{
    id: string       // classId
    studentId: string
  }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const teacherId = session.user.id
    const { id: classId, studentId } = await params
    const { searchParams } = new URL(request.url)
    const pageId = searchParams.get('pageId')
    const adaptersParam = searchParams.get('adapters')

    if (!pageId) {
      return NextResponse.json(
        { error: 'pageId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify teacher owns this class
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true },
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    if (classRecord.teacherId !== teacherId) {
      return NextResponse.json(
        { error: 'You do not own this class' },
        { status: 403 }
      )
    }

    // Verify student is in this class
    const membership = await prisma.classMembership.findUnique({
      where: {
        classId_studentId: {
          classId,
          studentId,
        },
      },
      select: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            studentPseudonym: true,
          },
        },
        identityConsent: true,
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'Student not found in this class' },
        { status: 404 }
      )
    }

    // Parse requested adapters (default to common ones)
    const adapters = adaptersParam
      ? adaptersParam.split(',').map(a => a.trim())
      : ['annotations', 'code', 'snaps']

    // Fetch student's personal data for the specified page and adapters
    const userData = await prisma.userData.findMany({
      where: {
        userId: studentId,
        itemId: pageId,
        targetType: null, // Only personal data, not targeted data
        targetId: null,
        OR: [
          // Exact adapter matches
          { adapter: { in: adapters } },
          // Quiz adapters (quiz-q1, quiz-q2, etc.)
          ...adapters
            .filter(a => a.startsWith('quiz-'))
            .map(a => ({ adapter: a })),
        ],
      },
      select: {
        adapter: true,
        data: true,
        updatedAt: true,
      },
    })

    // Also fetch any adapters that start with 'quiz-' if 'quiz' was requested
    let quizData: typeof userData = []
    if (adapters.some(a => a === 'quiz')) {
      quizData = await prisma.userData.findMany({
        where: {
          userId: studentId,
          itemId: pageId,
          targetType: null,
          targetId: null,
          adapter: { startsWith: 'quiz-' },
        },
        select: {
          adapter: true,
          data: true,
          updatedAt: true,
        },
      })
    }

    // Combine results into a map
    const allData = [...userData, ...quizData]
    const dataMap: Record<string, { data: unknown; updatedAt: number }> = {}
    const updatedAtMap: Record<string, number> = {}

    for (const item of allData) {
      dataMap[item.adapter] = {
        data: item.data,
        updatedAt: item.updatedAt.getTime(),
      }
      updatedAtMap[item.adapter] = item.updatedAt.getTime()
    }

    // Determine display name based on identity consent
    const displayName = membership.identityConsent
      ? membership.student.name || membership.student.email || 'Unknown'
      : `Student ${membership.student.studentPseudonym?.slice(0, 8) || studentId.slice(0, 8)}`

    return NextResponse.json({
      studentId,
      displayName,
      pseudonym: membership.student.studentPseudonym,
      data: dataMap,
      updatedAt: updatedAtMap,
    })
  } catch (error) {
    console.error('[classes/students/user-data] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
