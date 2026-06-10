import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/internal/check-lockdown?pageSlug=<slug>
 *
 * Internal endpoint called by the middleware (src/proxy.ts) to decide whether a
 * logged-in student must be sent to the SEB-required screen for a teacher's site.
 *
 * Returns `{ locked: true }` only when ALL of these hold:
 *   - there is a NextAuth session (cookie forwarded by the middleware), and
 *   - that user is a student, and
 *   - they belong to at least one class of the site's teacher with lockdownMode on.
 *
 * Anonymous visitors, teachers, and students with no lockdown class → `{ locked: false }`.
 * This is anti-distraction, NOT security: the SEB check itself (User-Agent) happens
 * in the middleware; here we only answer "is this student under a lockdown class".
 */
export async function GET(request: NextRequest) {
  try {
    const pageSlug = request.nextUrl.searchParams.get('pageSlug')
    if (!pageSlug) {
      return NextResponse.json({ error: 'pageSlug parameter required' }, { status: 400 })
    }

    const session = await getServerSession(authOptions)
    // No session, or not a student → never locked (teachers browse freely; anon bypasses).
    if (!session?.user?.id || session.user.accountType !== 'student') {
      return NextResponse.json({ locked: false })
    }

    // The teacher's URL slug lives on Site. An org site has no userId, so a student
    // on an org page resolves to no teacher → not locked.
    const site = await prisma.site.findUnique({
      where: { slug: pageSlug },
      select: { userId: true },
    })
    if (!site?.userId) {
      return NextResponse.json({ locked: false })
    }

    const lockedClass = await prisma.class.findFirst({
      where: {
        teacherId: site.userId,
        lockdownMode: true,
        isActive: true,
        memberships: { some: { studentId: session.user.id } },
      },
      select: { id: true },
    })

    return NextResponse.json({ locked: !!lockedClass })
  } catch (error) {
    console.error('Error checking lockdown:', error)
    // Fail open — this is anti-distraction, not security. A DB hiccup must not
    // lock everyone out of the site.
    return NextResponse.json({ locked: false })
  }
}
