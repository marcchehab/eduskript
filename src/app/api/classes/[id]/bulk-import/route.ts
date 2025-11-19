import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generatePseudonym } from '@/lib/privacy/pseudonym'
import { bulkImportRateLimiter } from '@/lib/rate-limit'

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

    // Generate pseudonyms for each email
    const emailPseudonymMap: Record<string, string> = {}
    const pseudonyms: string[] = []

    for (const email of normalizedEmails) {
      const pseudonym = generatePseudonym(email)
      emailPseudonymMap[email] = `student_${pseudonym}@eduskript.local`
      pseudonyms.push(pseudonym)
    }

    // Check which students are already members (signed up and joined)
    const existingMembers = await prisma.classMembership.findMany({
      where: {
        classId,
        student: {
          studentPseudonym: {
            in: pseudonyms
          }
        }
      },
      include: {
        student: {
          select: {
            studentPseudonym: true
          }
        }
      }
    })

    const existingPseudonyms = new Set(
      existingMembers.map(m => m.student.studentPseudonym)
    )

    // Check which pseudonyms are already pre-authorized
    const existingPreAuths = await prisma.preAuthorizedStudent.findMany({
      where: {
        classId,
        pseudonym: {
          in: pseudonyms
        }
      },
      select: {
        pseudonym: true
      }
    })

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

      console.log('[API] Pre-authorized students for class:', {
        classId,
        count: pseudonymsToAdd.length
      })
    }

    // Return statistics only (never expose email->pseudonym mappings)
    return NextResponse.json({
      imported: pseudonymsToAdd.length,
      alreadyMembers: existingPseudonyms.size,
      alreadyPreAuthorized: preAuthPseudonyms.size,
      total: normalizedEmails.length,
      // Security: Mappings are stored server-side only
      // Use the verification endpoint to check individual emails
    })
  } catch (error) {
    console.error('[API] Error bulk importing students:', error)
    return NextResponse.json(
      { error: 'Failed to import students' },
      { status: 500 }
    )
  }
}
