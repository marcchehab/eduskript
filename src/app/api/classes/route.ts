import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'

// GET /api/classes - List teacher's classes
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is a teacher
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { accountType: true }
    })

    if (user?.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can manage classes' },
        { status: 403 }
      )
    }

    // Get all classes for this teacher with member counts
    const classes = await prisma.class.findMany({
      where: {
        teacherId: session.user.id,
        isActive: true
      },
      include: {
        _count: {
          select: {
            memberships: true,
            preAuthorizedStudents: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json({
      classes: classes.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        inviteCode: c.inviteCode,
        allowAnonymous: c.allowAnonymous,
        memberCount: c._count.memberships,
        preAuthorizedCount: c._count.preAuthorizedStudents,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      }))
    })
  } catch (error) {
    console.error('[API] Error listing classes:', error)
    return NextResponse.json({ error: 'Failed to list classes' }, { status: 500 })
  }
}

// POST /api/classes - Create a new class
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is a teacher
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { accountType: true }
    })

    if (user?.accountType !== 'teacher') {
      return NextResponse.json(
        { error: 'Only teachers can create classes' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name, description, allowAnonymous } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Class name is required' }, { status: 400 })
    }

    // Generate a unique invite code (16-character hex)
    let inviteCode: string
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      inviteCode = randomBytes(8).toString('hex')

      // Check if code already exists
      const existing = await prisma.class.findUnique({
        where: { inviteCode }
      })

      if (!existing) {
        break
      }

      attempts++
    }

    if (attempts === maxAttempts) {
      return NextResponse.json(
        { error: 'Failed to generate unique invite code' },
        { status: 500 }
      )
    }

    // Create the class
    const newClass = await prisma.class.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        teacherId: session.user.id,
        inviteCode: inviteCode!,
        allowAnonymous: allowAnonymous === true // Default false if not provided
      },
      include: {
        _count: {
          select: {
            memberships: true,
            preAuthorizedStudents: true
          }
        }
      }
    })

    return NextResponse.json({
      class: {
        id: newClass.id,
        name: newClass.name,
        description: newClass.description,
        inviteCode: newClass.inviteCode,
        allowAnonymous: newClass.allowAnonymous,
        memberCount: 0,
        preAuthorizedCount: 0,
        createdAt: newClass.createdAt,
        updatedAt: newClass.updatedAt
      }
    }, { status: 201 })
  } catch (error) {
    console.error('[API] Error creating class:', error)
    return NextResponse.json({ error: 'Failed to create class' }, { status: 500 })
  }
}
