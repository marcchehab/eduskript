import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { generatePseudonym } from '@/lib/privacy/pseudonym'
import { bulkImportRateLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/events'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

// POST /api/classes/[id]/bulk-import - Import student emails and pre-authorize them
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: classId } = await params
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isPaidUser(session.user)) {
      return paidOnlyResponse('Class management is a paid feature.')
    }

    // Rate limiting (per user, not IP)
    const rateLimit = bulkImportRateLimiter.check(session.user.id)

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many bulk imports. Please try again in ${Math.ceil((rateLimit.retryAfter || 0) / 60)} minutes.`,
          retryAfter: rateLimit.retryAfter
        },
        { status: 429 }
      )
    }

    // Verify class exists and user owns it
    const classRecord = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true, name: true }
    })

    if (!classRecord) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    if (classRecord.teacherId !== session.user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to modify this class' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { emails } = body

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: 'emails must be a non-empty array' },
        { status: 400 }
      )
    }

    // Validate and normalize emails
    const normalizedEmails = emails
      .map(email => {
        if (typeof email !== 'string') return null
        const trimmed = email.toLowerCase().trim()
        // Basic email validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
        return trimmed
      })
      .filter((email): email is string => email !== null)

    if (normalizedEmails.length === 0) {
      return NextResponse.json(
        { error: 'No valid emails provided' },
        { status: 400 }
      )
    }

    // === FEATURE: Direct add existing users with clear emails ===
    // Check which emails belong to existing users (teachers or students with stored emails)
    // Use case-insensitive matching to handle legacy non-normalized emails
    const existingUsers = await prisma.user.findMany({
      where: {
        email: { in: normalizedEmails, mode: 'insensitive' }
      },
      select: { id: true, email: true, name: true }
    })

    // Normalize email keys for proper matching (database might have mixed-case emails)
    const existingEmailMap = new Map(existingUsers.map(u => [u.email!.toLowerCase(), u]))

    // Check which existing users are already members
    const existingUserIds = existingUsers.map(u => u.id)
    const alreadyMemberUserIds = existingUserIds.length > 0
      ? new Set(
          (await prisma.classMembership.findMany({
            where: { classId, studentId: { in: existingUserIds } },
            select: { studentId: true }
          })).map(m => m.studentId)
        )
      : new Set<string>()

    // Split: existing users to direct-add vs emails to pre-authorize
    const usersToDirectAdd = existingUsers.filter(u => !alreadyMemberUserIds.has(u.id))
    const emailsToPreAuthorize = normalizedEmails.filter(e => !existingEmailMap.has(e))

    // Direct add existing users to class
    if (usersToDirectAdd.length > 0) {
      await prisma.classMembership.createMany({
        data: usersToDirectAdd.map(u => ({
          classId,
          studentId: u.id,
          identityConsent: true,
          consentedAt: new Date()
        }))
      })

      // Clean up any pre-existing PreAuthorizedStudent records for these emails
      // (in case they were imported before the user account was created)
      const directAddEmails = usersToDirectAdd.map(u => u.email!).filter(Boolean)
      const directAddPseudonyms = directAddEmails.map(email => generatePseudonym(email))
      if (directAddPseudonyms.length > 0) {
        await prisma.preAuthorizedStudent.deleteMany({
          where: {
            classId,
            pseudonym: { in: directAddPseudonyms }
          }
        })
      }

      // Notify each directly added user via SSE
      for (const user of usersToDirectAdd) {
        await eventBus.publish(`user:${user.id}`, {
          type: 'class-invitation',
          classId,
          className: classRecord.name,
          directAdd: true
        })
      }
    }

    // === Continue with pseudonym flow for remaining emails ===
    // Generate pseudonyms for emails that don't have existing accounts
    const emailPseudonymMap: Record<string, string> = {}
    const pseudonyms: string[] = []

    for (const email of emailsToPreAuthorize) {
      const pseudonym = generatePseudonym(email)
      emailPseudonymMap[email] = `student_${pseudonym}@eduskript.local`
      pseudonyms.push(pseudonym)
    }

    // Check which students are already members (signed up and joined via pseudonym)
    const existingMembers = pseudonyms.length > 0
      ? await prisma.classMembership.findMany({
          where: {
            classId,
            student: {
              studentPseudonym: { in: pseudonyms }
            }
          },
          include: {
            student: {
              select: {
                id: true,
                studentPseudonym: true
              }
            }
          }
        })
      : []

    const existingPseudonyms = new Set(
      existingMembers.map(m => m.student.studentPseudonym)
    )

    // Check which pseudonyms are already pre-authorized
    const existingPreAuths = pseudonyms.length > 0
      ? await prisma.preAuthorizedStudent.findMany({
          where: {
            classId,
            pseudonym: { in: pseudonyms }
          },
          select: { pseudonym: true }
        })
      : []

    const preAuthPseudonyms = new Set(existingPreAuths.map(p => p.pseudonym))

    // Only add pseudonyms that are not already members or pre-authorized
    const pseudonymsToAdd = pseudonyms.filter(
      p => !existingPseudonyms.has(p) && !preAuthPseudonyms.has(p)
    )

    // Bulk create pre-authorized students
    if (pseudonymsToAdd.length > 0) {
      await prisma.preAuthorizedStudent.createMany({
        data: pseudonymsToAdd.map(pseudonym => ({
          classId,
          pseudonym
        }))
      })

      // Publish real-time events for each pre-authorized student
      // Students subscribed to their pseudonym channel will receive this
      for (const pseudonym of pseudonymsToAdd) {
        await eventBus.publish(`pseudonym:${pseudonym}`, {
          type: 'class-invitation',
          classId,
          className: classRecord.name
        })
      }
    }

    // Build summary message
    const messageParts: string[] = []
    if (usersToDirectAdd.length > 0) {
      messageParts.push(`${usersToDirectAdd.length} existing user${usersToDirectAdd.length !== 1 ? 's' : ''} added to class`)
    }
    if (pseudonymsToAdd.length > 0) {
      messageParts.push(`${pseudonymsToAdd.length} student${pseudonymsToAdd.length !== 1 ? 's' : ''} will see invitation when they sign in`)
    }
    const message = messageParts.join(', ') || 'No new members to add'

    // Return statistics
    return NextResponse.json({
      directlyAdded: usersToDirectAdd.length,
      imported: pseudonymsToAdd.length,
      alreadyMembers: alreadyMemberUserIds.size + existingPseudonyms.size,
      alreadyPreAuthorized: preAuthPseudonyms.size,
      total: normalizedEmails.length,
      message
    })
  } catch (error) {
    console.error('[API] Error bulk importing students:', error)
    return NextResponse.json(
      { error: 'Failed to import students' },
      { status: 500 }
    )
  }
}

// DELETE /api/classes/[id]/bulk-import - Remove a pre-authorized student by email
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
        { error: 'You do not have permission to modify this class' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'email is required' },
        { status: 400 }
      )
    }

    // Generate pseudonym from email
    const pseudonym = generatePseudonym(email.toLowerCase().trim())

    // Delete the pre-authorization
    const deleted = await prisma.preAuthorizedStudent.deleteMany({
      where: {
        classId,
        pseudonym
      }
    })

    if (deleted.count === 0) {
      return NextResponse.json(
        { error: 'Pre-authorization not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Error deleting pre-authorized student:', error)
    return NextResponse.json(
      { error: 'Failed to delete pre-authorization' },
      { status: 500 }
    )
  }
}
