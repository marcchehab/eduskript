/**
 * Student User Data API (for teachers)
 *
 * GET /api/classes/[classId]/students/[studentId]/user-data
 *   ?pageId={pageId}&siteId={siteId}
 *   &adapters=annotations,code,snaps,quiz-q1
 *
 * Fetch a specific student's user data for teacher viewing.
 *
 * Security (site scoping, src/lib/class-site-auth.ts):
 * 1. Teacher must own the class that the student is enrolled in
 * 2. Teacher must own the site (`siteId`) — rows are filtered to that site.
 *    Page authorship grants nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkClassSiteRead } from '@/lib/class-site-auth'

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

    // Site scoping: the student's data ON ONE SITE. Class teacher must own
    // that (personal) site — authorship of the page grants nothing.
    const siteId = searchParams.get('siteId')
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true, isImplicit: true, implicitPageId: true },
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    const denied = await checkClassSiteRead(teacherId, classRecord, siteId, pageId)
    if (denied) return denied

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
        siteId: siteId!,
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
          siteId: siteId!,
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
