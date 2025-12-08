import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

interface QuizData {
  selected?: number[]
  textAnswer?: string
  numberAnswer?: number
  isSubmitted: boolean
}

interface QuizResponseItem {
  studentId: string
  pseudonym: string
  displayName: string
  data: QuizData | null
  submittedAt: number | null
  // For choice questions, include correctness
  isCorrect?: boolean
  isPartiallyCorrect?: boolean
}

interface QuizStats {
  correct: number
  partial: number
  wrong: number
  notAnswered: number
  total: number
}

// GET /api/classes/[id]/quiz-responses?pageId=X&componentId=Y
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const pageId = searchParams.get('pageId')
    const componentId = searchParams.get('componentId')

    if (!pageId || !componentId) {
      return NextResponse.json(
        { error: 'Missing required parameters: pageId and componentId' },
        { status: 400 }
      )
    }

    // Verify class exists and user owns it
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true }
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    if (classRecord.teacherId !== session.user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to view this class' },
        { status: 403 }
      )
    }

    // Get all members of the class
    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            studentPseudonym: true
          }
        }
      }
    })

    // Get the student IDs
    const studentIds = memberships.map(m => m.student.id)

    // Get quiz responses for all students in the class
    // The adapter is the componentId (e.g., "quiz-q1"), itemId is the pageId
    const responses = await prisma.userData.findMany({
      where: {
        userId: { in: studentIds },
        adapter: componentId,
        itemId: pageId
      },
      select: {
        userId: true,
        data: true,
        updatedAt: true
      }
    })

    // Create a map for quick lookup
    const responseMap = new Map(
      responses.map(r => [r.userId, { data: r.data as unknown as QuizData, updatedAt: r.updatedAt }])
    )

    // Get correctIndices from query param if provided (for calculating correctness)
    const correctIndicesParam = searchParams.get('correctIndices')
    const correctIndices: number[] = correctIndicesParam
      ? JSON.parse(correctIndicesParam)
      : []

    // Build response items and calculate stats
    const stats: QuizStats = {
      correct: 0,
      partial: 0,
      wrong: 0,
      notAnswered: 0,
      total: memberships.length
    }

    const responseItems: QuizResponseItem[] = memberships.map(m => {
      const response = responseMap.get(m.student.id)
      const quizData = response?.data ?? null
      const isSubmitted = quizData?.isSubmitted ?? false

      // Calculate correctness for choice questions
      let isCorrect = false
      let isPartiallyCorrect = false

      if (!isSubmitted) {
        stats.notAnswered++
      } else if (correctIndices.length > 0 && quizData?.selected) {
        // Choice question with known correct answers
        const selectedSet = new Set(quizData.selected)
        const correctSet = new Set(correctIndices)

        // Check if all correct answers are selected and no wrong answers
        const allCorrectSelected = correctIndices.every(i => selectedSet.has(i))
        const noWrongSelected = quizData.selected.every(i => correctSet.has(i))

        if (allCorrectSelected && noWrongSelected) {
          isCorrect = true
          stats.correct++
        } else if (quizData.selected.some(i => correctSet.has(i))) {
          // At least one correct answer selected
          isPartiallyCorrect = true
          stats.partial++
        } else {
          stats.wrong++
        }
      } else {
        // Text/number question or no correct indices - just count as answered
        // For now, we can't determine correctness without manual grading
        // Count as "answered" which we'll track as "correct" for simplicity
        stats.correct++
      }

      return {
        studentId: m.student.id,
        pseudonym: m.student.studentPseudonym ?? '',
        displayName: m.student.name ?? `Student ${m.student.studentPseudonym?.slice(0, 6)}`,
        data: quizData,
        submittedAt: response?.updatedAt ? response.updatedAt.getTime() : null,
        isCorrect,
        isPartiallyCorrect
      }
    })

    return NextResponse.json({
      stats,
      responses: responseItems
    })
  } catch (error) {
    console.error('[API] Error fetching quiz responses:', error)
    return NextResponse.json(
      { error: 'Failed to fetch quiz responses' },
      { status: 500 }
    )
  }
}
