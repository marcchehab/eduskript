import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

// GET /api/classes/[id]/students - List students in a class
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // Check for optional pageId to include annotation status
    const { searchParams } = new URL(request.url)
    const pageId = searchParams.get('pageId')

    // Get all members with identity consent status
    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            studentPseudonym: true,
            lastSeenAt: true
          }
        }
      },
      orderBy: {
        joinedAt: 'desc'
      }
    })

    // If pageId provided, check which students have annotations on that page
    let studentsWithAnnotations: Set<string> = new Set()
    if (pageId) {
      const studentIds = memberships.map(m => m.student.id)
      const annotations = await prisma.userData.findMany({
        where: {
          targetType: 'student',
          targetId: { in: studentIds },
          adapter: 'annotations',
          itemId: pageId,
        },
        select: {
          targetId: true,
          data: true,
        }
      })
      // Only count students with non-empty canvasData
      for (const ann of annotations) {
        const data = ann.data as { canvasData?: string } | null
        if (ann.targetId && data?.canvasData && data.canvasData.length > 0 && data.canvasData !== '[]') {
          studentsWithAnnotations.add(ann.targetId)
        }
      }
    }

    return NextResponse.json({
      students: memberships.map(m => ({
        id: m.student.id,
        displayName: m.student.name, // e.g., "student-a1b2c3d4"
        pseudonym: m.student.studentPseudonym, // e.g., "a1b2c3d4e5f6g7h8"
        // Only show real email if student has given identity consent
        email: m.identityConsent && m.student.email
          ? m.student.email
          : `student_${m.student.studentPseudonym}@eduskript.local`,
        revealedEmail: m.identityConsent ? m.student.email : null,
        identityConsent: m.identityConsent,
        consentedAt: m.consentedAt,
        joinedAt: m.joinedAt,
        lastSeenAt: m.student.lastSeenAt,
        ...(pageId && { hasAnnotationsOnPage: studentsWithAnnotations.has(m.student.id) })
      }))
    })
  } catch (error) {
    console.error('[API] Error listing class students:', error)
    return NextResponse.json(
      { error: 'Failed to list students' },
      { status: 500 }
    )
  }
}
