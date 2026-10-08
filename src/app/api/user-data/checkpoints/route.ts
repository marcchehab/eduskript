/**
 * User Data Checkpoints API
 *
 * Server-side snapshots of student work captured on explicit events:
 *   - kind='manual'  — student clicked Save in the code editor
 *   - kind='check'   — Python check / SQL verification was run
 *   - kind='run'     — student clicked Run (deduped client-side: identical
 *                      consecutive runs collapse to a single checkpoint)
 *   - kind='handin'  — exam hand-in (also written via the hand-in route's batch path)
 *   - kind='autosave'— text-quiz answer snapshot on change (exam pages only;
 *                      deduped client-side by content). Does NOT emit a teacher
 *                      live-feed SSE event — the teacher reads the history on
 *                      demand via /component-snapshots.
 *
 * Bounded volume because all kinds are debounced/deduped client-side. This is
 * NOT a keystroke autosave log — that stays local in IndexedDB userData_history.
 *
 * Auth model:
 *   POST: NextAuth session OR exam_session cookie. Teachers must be on a paid
 *         plan (consistent with /api/user-data/sync from bd3162d). Students
 *         inherit their teacher's plan via class membership.
 *   GET:  NextAuth session. A user can list their own checkpoints; site
 *         managers can list any user's checkpoints on their site.
 *
 * Site scoping (src/lib/site-access.ts): every checkpoint carries the site it
 * was taken on. POST requires `siteId` per item and the page must be placed on
 * that site; an SEB exam session bound to a site only accepts that site. GET
 * requires `siteId` and filters by it; reading someone else's checkpoints
 * requires managing that site (no superadmin bypass, authorship grants
 * nothing).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageSite, isItemPlacedOnSite } from '@/lib/site-access'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import { eventBus } from '@/lib/events'

interface CheckpointInput {
  pageId: string
  siteId: string
  componentId: string
  kind: 'manual' | 'check' | 'handin' | 'run' | 'autosave'
  payload: unknown
  label?: string
}

const VALID_KINDS = new Set(['manual', 'check', 'handin', 'run', 'autosave'])

async function resolveAuthUserId(): Promise<{ userId: string; isTeacher: boolean; examSiteId?: string } | null> {
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
      // Cookie holds `sessionId` (random hex), not the row PK `id`.
      where: { sessionId: examSessionCookie },
      select: { userId: true, expiresAt: true, siteId: true },
    })
    if (examSession && new Date(examSession.expiresAt) > new Date()) {
      // '' = legacy session from before site scoping: no site pin.
      return { userId: examSession.userId, isTeacher: false, examSiteId: examSession.siteId || undefined }
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
      if (!item.siteId || typeof item.siteId !== 'string') {
        return NextResponse.json({ error: 'Each checkpoint requires siteId' }, { status: 400 })
      }
      if (auth.examSiteId && item.siteId !== auth.examSiteId) {
        return NextResponse.json({ error: 'Exam session is bound to another site' }, { status: 403 })
      }
    }
    // Placement check per distinct (page, site) pair.
    const pairs = [...new Map(items.map((i) => [`${i.siteId}\u0000${i.pageId}`, i])).values()]
    for (const { pageId, siteId } of pairs) {
      if (!(await isItemPlacedOnSite(pageId, siteId))) {
        return NextResponse.json({ error: 'Page is not placed on this site' }, { status: 403 })
      }
    }

    const created = await prisma.$transaction(
      items.map(item =>
        prisma.userDataCheckpoint.create({
          data: {
            userId: auth.userId,
            siteId: item.siteId,
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

    // Student-initiated checkpoints (Run / Check / manual save) feed the
    // teacher's "view this student" snapshot UI. Emit per page touched so an
    // open teacher viewer refetches in real time. 'autosave' is excluded — it
    // fires on every debounced keystroke and would flood the live feed; the
    // teacher reads that history on demand instead.
    const liveItems = items.filter((item) => item.kind !== 'autosave')
    if (!auth.isTeacher && liveItems.length > 0) {
      try {
        const memberships = await prisma.classMembership.findMany({
          where: { studentId: auth.userId },
          select: { classId: true },
        })
        if (memberships.length > 0) {
          const pageSites = [...new Map(liveItems.map((item) => [`${item.siteId}:${item.pageId}`, item])).values()]
          await Promise.all(
            pageSites.flatMap(({ pageId, siteId }) =>
              memberships.map((m) =>
                eventBus.publish(`class:${m.classId}:teacher`, {
                  type: 'student-work-update',
                  studentId: auth.userId,
                  classId: m.classId,
                  pageId,
                  siteId,
                  timestamp: Date.now(),
                })
              )
            )
          )
        }
      } catch (err) {
        console.error('[checkpoints] failed to publish student-work-update:', err)
      }
    }

    return NextResponse.json({ created })
  } catch (error) {
    console.error('[checkpoints] POST failed:', error)
    return NextResponse.json({ error: 'Failed to create checkpoint' }, { status: 500 })
  }
}

/**
 * GET /api/user-data/checkpoints?pageId=X&siteId=S&componentId=Y&studentId=Z
 *
 * Lists checkpoint metadata (no payload) on site S. studentId defaults to the
 * caller. Authorization:
 *   - studentId == self: always allowed.
 *   - studentId != self: caller must manage site S.
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
    const siteId = searchParams.get('siteId')

    if (!pageId || !siteId) {
      return NextResponse.json({ error: 'pageId and siteId required' }, { status: 400 })
    }

    const isSelf = studentId === session.user.id
    if (!isSelf && !(await canManageSite(session.user.id, siteId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const where: {
      userId: string
      siteId: string
      pageId: string
      componentId?: string
    } = {
      userId: studentId,
      siteId,
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
