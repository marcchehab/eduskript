/**
 * Student User Data API (for teachers)
 *
 * GET /api/classes/[classId]/students/[studentId]/user-data
 *   ?pageId={pageId}
 *   &adapters=annotations,code,snaps,quiz-q1
 *
 * Fetch a specific student's user data for teacher viewing.
 *
 * Security Requirements (both must be true):
 * 1. Teacher must own the class that the student is enrolled in
 * 2. Teacher must have view rights on the page (author on page, skript, or collection)
 *
 * This dual check ensures:
 * - Teachers can't view student work on pages they don't teach
 * - Teachers can't view students who aren't in their class
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'

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

    // Verify teacher has view rights on this page
    // This prevents teachers from viewing student work on pages they don't teach
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: {
        authors: { include: { user: { select: { id: true } } } },
        skript: {
          include: {
            authors: { include: { user: { select: { id: true } } } },
          },
        },
      },
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    const pagePermissions = checkPagePermissions(
      teacherId,
      page.authors,
      page.skript?.authors || [],
    )

    if (!pagePermissions.canView) {
      return NextResponse.json(
        { error: 'You do not have access to this page' },
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

    // Determine display name based on identity consent. We never synthesise
    // a fallback nickname — the DB column is the source of truth, and signup
    // writes a stable nickname into User.name.
    const displayName = membership.identityConsent
      ? membership.student.name || membership.student.email || '—'
      : membership.student.name || '—'

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
