/**
 * Shared plugin lists, see src/lib/plugin-share.ts.
 *
 * POST  publish the caller's values (and an optional payload) from an embedding
 *       with share="…"; with `shared` the site owner writes the embedding's
 *       shared state instead
 * GET   ?siteId&source&value&limit[&classId][&pageId&componentId[&payload=1]]
 *       read a list; with pageId and componentId also the shared state of that
 *       embedding and, with payload=1, each student's payload
 * PATCH the site owner renames a student (User.name is the nickname; students
 *       change their own through /api/user/nickname)
 *
 * The site owner and members of the owner's classes are the only readers:
 * nicknames are not public, even on a public page. The email goes to the
 * owner only, and only with the student's identityConsent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events'
import { RateLimiter } from '@/lib/rate-limit'
import { getSiteAccess, isSkriptPlacedOnSite } from '@/lib/site-access'
import { nicknameSchema } from '@/lib/nickname'
import { notifyNicknameChange } from '@/lib/plugin-share.server'
import {
  CLASS_LIST,
  MAX_LIST_ROWS,
  PAYLOAD_KEY,
  PLUGIN_SHARE_ADAPTER,
  PLUGIN_SHARE_TARGET,
  SHARED_AT_KEY,
  SHARED_KEY,
  fitsPayload,
  isValidListName,
  mergeValues,
  parseKeep,
  rankTotals,
  sanitizeValues,
  sumByUser,
  type ShareEntry,
  type ShareResults,
  type ShareValues,
} from '@/lib/plugin-share'

const publishLimiter = new RateLimiter('plugin-share', { interval: 60_000, maxRequests: 60 })
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status })

async function siteOwnerId(siteId: string): Promise<string | null> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  return site?.userId ?? null
}

/** All memberships in the teacher's classes; the owner's classes are the site's. */
function teacherMemberships(teacherId: string) {
  return prisma.classMembership.findMany({
    where: { class: { teacherId, isImplicit: false } },
    select: {
      classId: true,
      studentId: true,
      identityConsent: true,
      student: { select: { name: true, email: true } },
    },
  })
}

/**
 * The page must carry share="…" or a <leaderboard> of that list, so a direct POST
 * cannot create lists. Tag attributes in double or single quotes, either order.
 */
async function pageSharesInto(pageId: string, siteId: string, list: string): Promise<boolean> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { content: true, skriptId: true, pageType: true },
  })
  if (!page || !(await isSkriptPlacedOnSite(page.skriptId, siteId))) return false
  if (new RegExp(`\\bshare=(["'])${list}\\1`).test(page.content)) return true
  // Exam pages are not collected; the components check too, this covers a direct POST.
  if (page.pageType === 'exam') return false
  return (page.content.match(/<leaderboard\b[^>]*>/g) ?? []).some((tag) =>
    new RegExp(`\\bsource=(["'])${list}\\1`).test(tag) || (list === CLASS_LIST && !/\bsource=/.test(tag)))
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return error('Unauthorized', 401)
  if (!publishLimiter.check(userId).allowed) return error('Too many requests', 429)

  const body = await request.json().catch(() => null)
  const { siteId, pageId, componentId, share, keep, values, payload, shared } = body ?? {}
  const clean = sanitizeValues(values)
  const writesShared = shared !== undefined
  if (typeof siteId !== 'string' || !siteId || typeof pageId !== 'string' || !pageId) return error('Invalid request', 400)
  if (typeof componentId !== 'string' || !componentId || componentId.length > 200) return error('Invalid request', 400)
  if (!isValidListName(share) || (!clean && !writesShared)) return error('Invalid request', 400)
  if ((payload !== undefined && !fitsPayload(payload)) || (writesShared && !fitsPayload(shared))) return error('Payload too large', 413)

  const owner = await siteOwnerId(siteId)
  if (!owner) return error('Not found', 404)

  // The site owner's shared state for this embedding. Stored in the owner's own
  // row: the owner is no class member, so the row never shows up in a list.
  if (writesShared) {
    if (owner !== userId) return error('Forbidden', 403)
    if (!(await pageSharesInto(pageId, siteId, share))) return error('This page does not share into that list', 403)
    const at = Date.now()
    const ownerKey = {
      userId, siteId, adapter: PLUGIN_SHARE_ADAPTER, itemId: share,
      targetType: PLUGIN_SHARE_TARGET, targetId: `${pageId}:${componentId}`,
    }
    const state = { [SHARED_KEY]: shared, [SHARED_AT_KEY]: at }
    await prisma.userData.upsert({
      where: { userId_siteId_adapter_itemId_targetType_targetId: ownerKey },
      create: { ...ownerKey, data: state },
      update: { data: state, version: { increment: 1 } },
    })
    // The state is per embedding, not per class: every class of the site hears it.
    const all = await prisma.class.findMany({ where: { teacherId: owner, isImplicit: false }, select: { id: true } })
    await Promise.all(all.map((c) =>
      eventBus.publish(`class:${c.id}`, { type: 'leaderboard-update', siteId, list: share, shared: true })))
    return NextResponse.json({ stored: true, at })
  }
  if (!clean) return error('Invalid request', 400)
  // Only class members land in a list; for anyone else this is a no-op, so a
  // teacher trying the page or an anonymous-like account gets no error.
  const isMember = await prisma.classMembership.count({
    where: { studentId: userId, class: { teacherId: owner, isImplicit: false } },
  })
  if (!isMember) return NextResponse.json({ stored: false })
  if (!(await pageSharesInto(pageId, siteId, share))) return error('This page does not share into that list', 403)

  const key = {
    userId, siteId, adapter: PLUGIN_SHARE_ADAPTER, itemId: share,
    targetType: PLUGIN_SHARE_TARGET, targetId: `${pageId}:${componentId}`,
  }
  const existing = await prisma.userData.findUnique({
    where: { userId_siteId_adapter_itemId_targetType_targetId: key },
    select: { data: true },
  })
  if (!existing) {
    const rows = await prisma.userData.count({
      where: { userId, siteId, adapter: PLUGIN_SHARE_ADAPTER, itemId: share, targetType: PLUGIN_SHARE_TARGET },
    })
    if (rows >= MAX_LIST_ROWS) return error('Too many entries in this list', 403)
  }
  // mergeValues keeps the keys not sent again, so an earlier payload stays; a new one replaces it.
  const data: Record<string, unknown> = mergeValues(existing?.data as ShareValues | null ?? null, clean, parseKeep(keep))
  if (payload !== undefined) data[PAYLOAD_KEY] = payload
  await prisma.userData.upsert({
    where: { userId_siteId_adapter_itemId_targetType_targetId: key },
    create: { ...key, data: data as object },
    update: { data: data as object, version: { increment: 1 } },
  })

  // Tell open leaderboards: a class list reaches the student's classes, a
  // named list every class of the site. One notification per class.
  const classes = await prisma.class.findMany({
    where: share === CLASS_LIST
      ? { teacherId: owner, isImplicit: false, memberships: { some: { studentId: userId } } }
      : { teacherId: owner, isImplicit: false },
    select: { id: true },
  })
  await Promise.all(classes.map((c) =>
    eventBus.publish(`class:${c.id}`, { type: 'leaderboard-update', siteId, list: share })))

  return NextResponse.json({ stored: true })
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return error('Unauthorized', 401)

  const params = new URL(request.url).searchParams
  const siteId = params.get('siteId')
  const source = params.get('source')
  const valueKey = params.get('value') || 'score'
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get('limit')) || DEFAULT_LIMIT))
  if (!siteId || !isValidListName(source)) return error('Invalid request', 400)
  const pageId = params.get('pageId')
  const componentId = params.get('componentId')
  const target = pageId && componentId ? `${pageId}:${componentId}` : null
  const withPayload = !!target && params.get('payload') === '1'

  const empty: ShareResults = { entries: [], self: null, classes: [], classId: null, member: false, nickname: null }
  const [owner, access] = await Promise.all([siteOwnerId(siteId), getSiteAccess(userId, siteId)])
  if (!owner) return NextResponse.json(empty)

  const memberships = await teacherMemberships(owner)
  const isOwner = !!access?.isOwner
  const own = memberships.filter((m) => m.studentId === userId)
  if (!isOwner && own.length === 0) return NextResponse.json(empty)

  const nickname = new Map(memberships.map((m) => [m.studentId, m.student.name ?? 'Student']))
  const nameOf = (id: string) => nickname.get(id) ?? 'Student'

  let classes: ShareResults['classes'] = []
  let classId: string | null = null
  let visible = new Set(memberships.map((m) => m.studentId))
  if (source === CLASS_LIST) {
    const rows = await prisma.class.findMany({
      // Archived classes are hidden from every class picker.
      where: isOwner
        ? { teacherId: owner, isImplicit: false, archivedAt: null }
        : { id: { in: own.map((m) => m.classId) }, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    })
    classes = rows
    const asked = params.get('classId')
    classId = rows.find((c) => c.id === asked)?.id ?? rows[0]?.id ?? null
    visible = new Set(memberships.filter((m) => m.classId === classId).map((m) => m.studentId))
  }

  const rows = await prisma.userData.findMany({
    where: { siteId, adapter: PLUGIN_SHARE_ADAPTER, itemId: source, targetType: PLUGIN_SHARE_TARGET, userId: { in: [...visible] } },
    select: { userId: true, data: true, targetId: true },
  })
  const payloads = new Map<string, unknown>()
  if (withPayload) {
    for (const row of rows) {
      const p = (row.data as Record<string, unknown> | null)?.[PAYLOAD_KEY]
      if (row.targetId === target && p !== undefined) payloads.set(row.userId, p)
    }
  }
  let shared: ShareResults['shared'] = undefined
  if (target) {
    const ownerRow = await prisma.userData.findUnique({
      where: { userId_siteId_adapter_itemId_targetType_targetId: {
        userId: owner, siteId, adapter: PLUGIN_SHARE_ADAPTER, itemId: source, targetType: PLUGIN_SHARE_TARGET, targetId: target,
      } },
      select: { data: true },
    })
    const state = ownerRow?.data as Record<string, unknown> | null | undefined
    const at = state?.[SHARED_AT_KEY]
    shared = state && typeof at === 'number' ? { value: state[SHARED_KEY], at } : null
  }
  // A class list only uses consent given in that class; a named list any.
  const consented = new Map(memberships
    .filter((m) => m.identityConsent && (!classId || m.classId === classId))
    .map((m) => [m.studentId, m.student.email]))
  const toEntry = (r: { userId: string; value: number; rank: number }): ShareEntry => ({
    rank: r.rank,
    nickname: nameOf(r.userId),
    value: r.value,
    isSelf: r.userId === userId,
    ...(payloads.has(r.userId) ? { payload: payloads.get(r.userId) } : {}),
    ...(isOwner ? { studentId: r.userId, email: consented.get(r.userId) ?? null } : {}),
  })
  const ranked = rankTotals(sumByUser(rows, valueKey))
  const self = ranked.find((r) => r.userId === userId)
  const results: ShareResults = {
    entries: ranked.slice(0, limit).map(toEntry),
    self: self ? toEntry(self) : null,
    classes,
    classId,
    member: true,
    nickname: own.length > 0 ? nameOf(userId) : null,
    isOwner,
    now: Date.now(),
    ...(target ? { shared } : {}),
  }
  return NextResponse.json(results)
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return error('Unauthorized', 401)

  const { siteId, nickname, studentId } = (await request.json().catch(() => null)) ?? {}
  if (typeof siteId !== 'string' || !siteId || typeof studentId !== 'string' || !studentId) return error('Invalid request', 400)
  const parsed = nicknameSchema.safeParse(nickname)
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid nickname', 400)
  const owner = await siteOwnerId(siteId)
  if (!owner) return error('Not found', 404)
  if (owner !== userId) return error('Forbidden', 403)

  const isMember = await prisma.classMembership.count({
    where: { studentId, class: { teacherId: owner, isImplicit: false } },
  })
  if (!isMember) return error('Not a member of a class on this site', 403)
  await prisma.user.update({ where: { id: studentId }, data: { name: parsed.data } })
  await notifyNicknameChange(studentId)
  return NextResponse.json({ nickname: parsed.data })
}
