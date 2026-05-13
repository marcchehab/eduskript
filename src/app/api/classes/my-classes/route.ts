import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/classes/my-classes - Get student's enrolled classes
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is a student
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { accountType: true, studentPseudonym: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.accountType !== 'student') {
      return NextResponse.json(
        { error: 'Only students can view enrolled classes' },
        { status: 403 }
      )
    }

    // Fast path: just check if any pending invitations exist
    const { searchParams } = new URL(request.url)
    if (searchParams.get('checkOnly') === 'true') {
      if (!user.studentPseudonym) {
        return NextResponse.json({ hasPendingInvitations: false })
      }
      const hasInvitations = await prisma.preAuthorizedStudent.findFirst({
        where: {
          pseudonym: user.studentPseudonym,
          class: { isActive: true }
        },
        select: { id: true }
      })
      return NextResponse.json({ hasPendingInvitations: !!hasInvitations })
    }

    // Get all classes the student is enrolled in (exclude implicit survey
    // pseudo-classes — they're not real student-facing classes)
    const memberships = await prisma.classMembership.findMany({
      where: {
        studentId: session.user.id,
        class: { isImplicit: false }
      },
      include: {
        class: {
          include: {
            teacher: {
              select: {
                name: true,
                site: { select: { slug: true } }
              }
            },
            _count: {
              select: {
                memberships: true
              }
            }
          }
        }
      },
      orderBy: {
        joinedAt: 'desc'
      }
    })

    // Get all pending join requests for this student (via pseudonym match)
    const joinRequests = user.studentPseudonym
      ? await prisma.preAuthorizedStudent.findMany({
          where: {
            pseudonym: user.studentPseudonym,
            class: { isImplicit: false }
          },
          include: {
            class: {
              select: {
                id: true,
                name: true,
                description: true,
                inviteCode: true,
                allowAnonymous: true,
                teacher: {
                  select: {
                    name: true
                  }
                }
              }
            }
          }
        })
      : []

    // Group join requests by class ID
    const requestsByClass = new Map<string, typeof joinRequests>()
    joinRequests.forEach(req => {
      const classId = req.classId
      if (!requestsByClass.has(classId)) {
        requestsByClass.set(classId, [])
      }
      requestsByClass.get(classId)!.push(req)
    })

    return NextResponse.json({
      classes: memberships.map(m => ({
        id: m.class.id,
        name: m.class.name,
        description: m.class.description,
        // Implicit-class filter above means teacher should always be present;
        // fallback kept for type-safety since teacherId is nullable in schema.
        teacherName: m.class.teacher?.name ?? '',
        memberCount: m.class._count.memberships,
        joinedAt: m.joinedAt,
      })),
      // Include pending join requests as separate list (not grouped by class)
      joinRequests: joinRequests.map(req => ({
        classId: req.classId,
        className: req.class.name,
        classDescription: req.class.description,
        teacherName: req.class.teacher?.name ?? '',
        inviteCode: req.class.inviteCode,
        allowAnonymous: req.class.allowAnonymous,
        addedAt: req.addedAt
      }))
    })
  } catch (error) {
    console.error('[API] Error getting student classes:', error)
    return NextResponse.json(
      { error: 'Failed to get classes' },
      { status: 500 }
    )
  }
}
