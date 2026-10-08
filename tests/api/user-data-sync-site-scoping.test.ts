import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// /api/user-data/sync under site scoping: every item names its site; items
// not placed there are rejected (kept local by the client), the public layer
// needs site management, class broadcasts need the own personal site, and
// rows are written/looked up with their siteId.

const mocks = vi.hoisted(() => ({
  prisma: {
    userData: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    examSession: { findUnique: vi.fn() },
    class: { findMany: vi.fn() },
    classMembership: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  access: {
    getSiteAccess: vi.fn(),
    isItemPlacedOnSite: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/site-access', () => mocks.access)
vi.mock('@/lib/site-revalidate', () => ({ revalidateItemOnSite: vi.fn() }))
vi.mock('@/lib/billing', () => ({ isPaidUser: () => true, paidOnlyResponse: () => new Response('', { status: 402 }) }))
vi.mock('@/lib/s3', () => ({ uploadSnapImage: vi.fn(), deleteSnapImage: vi.fn(), isS3Configured: () => false }))
vi.mock('@/lib/events', () => ({ eventBus: { publish: vi.fn() } }))

import { getServerSession } from 'next-auth'
import { POST } from '@/app/api/user-data/sync/route'

const p = mocks.prisma
const a = mocks.access
const session = getServerSession as unknown as ReturnType<typeof vi.fn>

function req(items: unknown[]) {
  return new NextRequest('http://localhost/api/user-data/sync', {
    method: 'POST',
    body: JSON.stringify({ items }),
    headers: { 'content-type': 'application/json' },
  })
}
const item = (over: Record<string, unknown> = {}) => ({
  siteId: 'site-a', adapter: 'quiz-q1', itemId: 'page-1', data: '{"selected":[1]}', version: 1, updatedAt: 1, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  p.userData.findFirst.mockResolvedValue(null)
  p.userData.create.mockResolvedValue({})
  p.classMembership.findMany.mockResolvedValue([])
  p.user.findUnique.mockResolvedValue({ studentPseudonym: 'x' })
  a.isItemPlacedOnSite.mockResolvedValue(true)
  a.getSiteAccess.mockResolvedValue({ siteId: 'site-a', kind: 'personal', canManage: false, isOwner: false })
})

describe('POST /api/user-data/sync — site scoping', () => {
  it('writes a student answer under its site (unique key includes siteId)', async () => {
    session.mockResolvedValue({ user: { id: 'student-1', accountType: 'student' } })
    const res = await POST(req([item()]))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.synced).toBe(1)
    expect(p.userData.findFirst.mock.calls[0][0].where).toMatchObject({ userId: 'student-1', siteId: 'site-a', itemId: 'page-1' })
    expect(p.userData.create.mock.calls[0][0].data).toMatchObject({ siteId: 'site-a', userId: 'student-1' })
  })

  it('rejects items without a siteId or not placed on the site — and keeps the rest', async () => {
    session.mockResolvedValue({ user: { id: 'student-1', accountType: 'student' } })
    a.isItemPlacedOnSite.mockImplementation(async (_itemId: string, siteId: string) => siteId === 'site-a')
    const res = await POST(req([item(), item({ siteId: 'site-b', adapter: 'quiz-q2' }), item({ siteId: '' , adapter: 'quiz-q3'})]))
    const body = await res.json()
    expect(body.synced).toBe(1)
    expect(body.rejected.map((r: { adapter: string }) => r.adapter).sort()).toEqual(['quiz-q2', 'quiz-q3'])
    expect(p.userData.create).toHaveBeenCalledTimes(1)
  })

  it('public layer (targetType page) requires managing the site — authorship and admin do not count', async () => {
    session.mockResolvedValue({ user: { id: 'coauthor', accountType: 'teacher', isAdmin: true } })
    a.getSiteAccess.mockResolvedValue({ siteId: 'site-a', kind: 'personal', canManage: false, isOwner: false })
    const res = await POST(req([item({ adapter: 'annotations', targetType: 'page', targetId: 'page-1' })]))
    const body = await res.json()
    expect(body.synced).toBe(0)
    expect(body.rejected).toHaveLength(1)
    expect(p.userData.create).not.toHaveBeenCalled()
  })

  it('public layer write by the org admin on the org site is accepted', async () => {
    session.mockResolvedValue({ user: { id: 'org-admin', accountType: 'teacher' } })
    a.getSiteAccess.mockResolvedValue({ siteId: 'org-site', kind: 'org', canManage: true, isOwner: false })
    const res = await POST(req([item({ siteId: 'org-site', adapter: 'annotations', targetType: 'page', targetId: 'page-1' })]))
    expect((await res.json()).synced).toBe(1)
    expect(p.userData.create.mock.calls[0][0].data).toMatchObject({ siteId: 'org-site', targetType: 'page' })
  })

  it('class broadcasts are refused on sites the teacher does not own (e.g. org sites)', async () => {
    session.mockResolvedValue({ user: { id: 'org-admin', accountType: 'teacher' } })
    a.getSiteAccess.mockResolvedValue({ siteId: 'org-site', kind: 'org', canManage: true, isOwner: false })
    const res = await POST(req([item({ siteId: 'org-site', adapter: 'annotations', targetType: 'class', targetId: 'class-1' })]))
    const body = await res.json()
    expect(body.synced).toBe(0)
    expect(body.rejected[0].reason).toMatch(/own site/)
  })

  it('class broadcasts on the own personal site pass (class ownership still checked)', async () => {
    session.mockResolvedValue({ user: { id: 'teacher-a', accountType: 'teacher' } })
    a.getSiteAccess.mockResolvedValue({ siteId: 'site-a', kind: 'personal', canManage: true, isOwner: true })
    p.class.findMany.mockResolvedValue([{ id: 'class-1' }])
    const res = await POST(req([item({ adapter: 'annotations', targetType: 'class', targetId: 'class-1' })]))
    expect((await res.json()).synced).toBe(1)
  })
})
