import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/pages/[id]/unlock
 * List all unlocks for a page (class and individual student unlocks)
 * Only accessible by page authors
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: pageId } = await params

    // Check if user is an author of this page
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        authors: {
          some: { userId: session.user.id }
        }
      }
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    // Get all unlocks for this page
    const unlocks = await prisma.pageUnlock.findMany({
      where: { pageId },
      include: {
        class: {
          select: {
            id: true,
            name: true
          }
        },
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            studentPseudonym: true
          }
        },
        teacher: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { unlockedAt: 'desc' }
    })

    return NextResponse.json({ unlocks })
  } catch (error) {
    console.error('Error fetching page unlocks:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/pages/[id]/unlock
 * Unlock a page for a class or individual student
 * Body: { classId?: string, studentId?: string }
 * Exactly one of classId or studentId must be provided
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: pageId } = await params
    const body = await request.json()
    const { classId, studentId } = body

    // Validate: exactly one of classId or studentId must be provided
    if ((!classId && !studentId) || (classId && studentId)) {
      return NextResponse.json(
        { error: 'Exactly one of classId or studentId must be provided' },
        { status: 400 }
      )
    }

    // Check if user is an author of this page
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        authors: {
          some: { userId: session.user.id }
        }
      }
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    // If unlocking for a class, verify the user is the teacher of that class
    if (classId) {
      const classRecord = await prisma.class.findFirst({
        where: {
          id: classId,
          teacherId: session.user.id
        }
      })

      if (!classRecord) {
        return NextResponse.json({ error: 'Class not found or you are not the teacher' }, { status: 403 })
      }
    }

    // If unlocking for a student, verify the student exists
    if (studentId) {
      const student = await prisma.user.findUnique({
        where: { id: studentId }
      })

      if (!student) {
        return NextResponse.json({ error: 'Student not found' }, { status: 404 })
      }
    }

    // Create or update the unlock
    const unlock = await prisma.pageUnlock.upsert({
      where: classId
        ? { pageId_classId: { pageId, classId } }
        : { pageId_studentId: { pageId, studentId: studentId! } },
      create: {
        pageId,
        classId: classId || null,
        studentId: studentId || null,
        unlockedBy: session.user.id
      },
      update: {
        unlockedBy: session.user.id,
        unlockedAt: new Date()
      },
      include: {
        class: {
          select: { id: true, name: true }
        },
        student: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    return NextResponse.json({ unlock })
  } catch (error) {
    console.error('Error creating page unlock:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/pages/[id]/unlock
 * Lock a page (remove unlock) for a class or student
 * Query params: ?classId=xxx or ?studentId=xxx
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: pageId } = await params
    const { searchParams } = new URL(request.url)
    const classId = searchParams.get('classId')
    const studentId = searchParams.get('studentId')

    // Validate: exactly one of classId or studentId must be provided
    if ((!classId && !studentId) || (classId && studentId)) {
      return NextResponse.json(
        { error: 'Exactly one of classId or studentId query param must be provided' },
        { status: 400 }
      )
    }

    // Check if user is an author of this page
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        authors: {
          some: { userId: session.user.id }
        }
      }
    })

    if (!page) {
      return NextResponse.json({ error: 'Page not found or access denied' }, { status: 404 })
    }

    // Delete the unlock
    const deleteWhere = classId
      ? { pageId_classId: { pageId, classId } }
      : { pageId_studentId: { pageId, studentId: studentId! } }

    try {
      await prisma.pageUnlock.delete({
        where: deleteWhere
      })
    } catch {
      // Unlock doesn't exist, that's fine
      return NextResponse.json({ message: 'Unlock not found (already locked)' }, { status: 200 })
    }

    return NextResponse.json({ message: 'Page locked successfully' })
  } catch (error) {
    console.error('Error deleting page unlock:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
