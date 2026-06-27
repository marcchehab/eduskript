/**
 * GET /api/viewer/access — the viewer's relationship to a page owner.
 *
 * Powers the <onlyfor students> / <onlyfor class="…"> markdown gate. Returns
 * only the caller's own relationship (never other users' data):
 *   { authenticated, isStudent, inClass }
 *
 * - authenticated: caller has a session.
 * - isStudent: caller is in any non-implicit class owned by `owner`.
 * - inClass: caller is in the owner's class matching `class` (name or invite code).
 *
 * `inClass` is false whether the class is missing or the caller isn't in it, so
 * this doesn't leak which class names exist. auth/anon gating needs no call
 * (the client uses useSession); this endpoint is only hit for students/class.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiRateLimiter, getClientIdentifier } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const rate = apiRateLimiter.check(getClientIdentifier(request))
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const session = await getServerSession(authOptions)
  const viewerId = session?.user?.id ?? null
  const result = { authenticated: !!viewerId, isStudent: false, inClass: false }

  const owner = request.nextUrl.searchParams.get('owner')?.trim()
  const klass = request.nextUrl.searchParams.get('class')?.trim()

  // Anonymous viewers, or no owner context, can't be students of anyone.
  if (!viewerId || !owner) {
    return NextResponse.json(result)
  }

  // Resolve the page owner (pageSlug → Site → userId).
  const site = await prisma.site.findUnique({
    where: { slug: owner },
    select: { userId: true },
  })
  const ownerUserId = site?.userId
  if (!ownerUserId) {
    return NextResponse.json(result)
  }

  // isStudent: in any real (non-implicit) class owned by this teacher.
  const membership = await prisma.classMembership.findFirst({
    where: {
      studentId: viewerId,
      class: { teacherId: ownerUserId, isImplicit: false },
    },
    select: { id: true },
  })
  result.isStudent = !!membership

  if (klass) {
    const cls = await prisma.class.findFirst({
      where: {
        teacherId: ownerUserId,
        isActive: true,
        isImplicit: false,
        OR: [{ name: klass }, { inviteCode: klass }],
      },
      select: { id: true },
    })
    if (cls) {
      const inClass = await prisma.classMembership.findUnique({
        where: { classId_studentId: { classId: cls.id, studentId: viewerId } },
        select: { id: true },
      })
      result.inClass = !!inClass
    }
  }

  return NextResponse.json(result)
}
