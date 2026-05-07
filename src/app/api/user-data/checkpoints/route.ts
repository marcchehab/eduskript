/**
 * User Data Checkpoints API
 *
 * Server-side snapshots of student work captured on explicit events:
 *   - kind='manual'  — student clicked Save in the code editor
 *   - kind='check'   — Python check / SQL verification was run
 *   - kind='run'     — student clicked Run (deduped client-side: identical
 *                      consecutive runs collapse to a single checkpoint)
 *   - kind='handin'  — exam hand-in (also written via the hand-in route's batch path)
 *
 * Bounded volume because all four events are user-initiated. This is NOT a
 * keystroke autosave log — that stays local in IndexedDB userData_history.
 *
 * Auth model:
 *   POST: NextAuth session OR exam_session cookie. Teachers must be on a paid
 *         plan (consistent with /api/user-data/sync from bd3162d). Students
 *         inherit their teacher's plan via class membership.
 *   GET:  NextAuth session. A user can list their own checkpoints; teachers
 *         can list checkpoints for students in their classes on pages those
 *         classes have unlocked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'

interface CheckpointInput {
  pageId: string
  componentId: string
  kind: 'manual' | 'check' | 'handin' | 'run'
  payload: unknown
  label?: string
}

const VALID_KINDS = new Set(['manual', 'check', 'handin', 'run'])

async function resolveAuthUserId(): Promise<{ userId: string; isTeacher: boolean } | null> {
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    const isTeacher = session.user.accountType === 'teacher'
    if (isTeacher && !isPaidUser(session.user)) {
      return { userId: session.user.id, isTeacher: true } // caller will gate via 402
    }
    return { userId: session.user.id, isTeacher }
  }

  // Fall back to exam session cookie (SEB mode)
  const cookieStore = await cookies()
  const examSessionCookie = cookieStore.get('exam_session')?.value
  if (!examSessionCookie) return null

  try {
    const examSession = await prisma.examSession.findUnique({
      where: { id: examSessionCookie },
      select: { userId: true, expiresAt: true },
    })
    if (examSession && new Date(examSession.expiresAt) > new Date()) {
      return { userId: examSession.userId, isTeacher: false }
    }
  } catch (error) {
    console.error('[checkpoints] exam-session lookup failed:', error)
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    // Apply paid-only gate before doing any work.
    if (session?.user?.id && session.user.accountType === 'teacher' && !isPaidUser(session.user)) {
      return paidOnlyResponse(
        'Server-side checkpoints are a paid feature. Manual saves stay local on the free plan.'
      )
    }

    const auth = await resolveAuthUserId()
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const items: CheckpointInput[] = Array.isArray(body?.checkpoints)
      ? body.checkpoints
      : body && typeof body === 'object'
        ? [body]
        : []

    if (items.length === 0) {
      return NextResponse.json({ error: 'No checkpoints in request' }, { status: 400 })
    }

    // Validate all items before any writes — partial inserts are confusing.
    for (const item of items) {
      if (!item.pageId || typeof item.pageId !== 'string') {
        return NextResponse.json({ error: 'Each checkpoint requires pageId' }, { status: 400 })
      }
      if (!item.componentId || typeof item.componentId !== 'string') {
        return NextResponse.json({ error: 'Each checkpoint requires componentId' }, { status: 400 })
      }
      if (!VALID_KINDS.has(item.kind)) {
        return NextResponse.json({ error: `Invalid kind '${item.kind}'` }, { status: 400 })
      }
      if (item.payload === undefined) {
        return NextResponse.json({ error: 'Each checkpoint requires payload' }, { status: 400 })
      }
    }

    const created = await prisma.$transaction(
      items.map(item =>
        prisma.userDataCheckpoint.create({
          data: {
            userId: auth.userId,
            pageId: item.pageId,
            componentId: item.componentId,
            kind: item.kind,
            payload: item.payload as object,
            label: item.label ?? null,
          },
          select: { id: true, createdAt: true, kind: true },
        })
      )
    )

    return NextResponse.json({ created })
  } catch (error) {
    console.error('[checkpoints] POST failed:', error)
    return NextResponse.json({ error: 'Failed to create checkpoint' }, { status: 500 })
  }
}

/**
 * GET /api/user-data/checkpoints?pageId=X&componentId=Y&studentId=Z
 *
 * Lists checkpoint metadata (no payload). studentId defaults to the caller.
 * Authorization:
 *   - studentId == self: always allowed.
 *   - studentId != self: caller must be a teacher of a class that the target
 *     student belongs to AND has the requested page unlocked.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const pageId = searchParams.get('pageId')
    const componentId = searchParams.get('componentId')
    const studentId = searchParams.get('studentId') ?? session.user.id

    if (!pageId) {
      return NextResponse.json({ error: 'pageId required' }, { status: 400 })
    }

    const isSelf = studentId === session.user.id
    if (!isSelf) {
      const allowed = await isTeacherOfStudentForPage(session.user.id, studentId, pageId)
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const where: {
      userId: string
      pageId: string
      componentId?: string
    } = {
      userId: studentId,
      pageId,
    }
    if (componentId) where.componentId = componentId

    const checkpoints = await prisma.userDataCheckpoint.findMany({
      where,
      select: {
        id: true,
        componentId: true,
        kind: true,
        label: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    return NextResponse.json({ checkpoints })
  } catch (error) {
    console.error('[checkpoints] GET failed:', error)
    return NextResponse.json({ error: 'Failed to list checkpoints' }, { status: 500 })
  }
}

/**
 * True if `viewerId` teaches a class that contains `studentId` and has
 * `pageId` unlocked. Mirrors the authorization shape used by the per-class
 * SQL/Python response endpoints.
 */
async function isTeacherOfStudentForPage(
  viewerId: string,
  studentId: string,
  pageId: string
): Promise<boolean> {
  const membership = await prisma.classMembership.findFirst({
    where: {
      studentId,
      class: {
        teacherId: viewerId,
        pageUnlocks: { some: { pageId } },
      },
    },
    select: { id: true },
  })
  return Boolean(membership)
}
