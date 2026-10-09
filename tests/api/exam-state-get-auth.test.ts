import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #42/#43: GET exam state requires auth (class teacher or member)
// and a siteId; rows are filtered by that site.

const mocks = vi.hoisted(() => ({
  prisma: {
    examState: { findFirst: vi.fn(async () => null) },
    examSession: { findUnique: vi.fn(async () => null) },
    class: { findUnique: vi.fn(async () => ({ teacherId: 'teacher' })) },
    classMembership: { findFirst: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/events', () => ({ eventBus: { publish: vi.fn() } }))
vi.mock('@/lib/site-access', () => ({ getSiteAccess: vi.fn(), isItemPlacedOnSite: vi.fn() }))

import { getServerSession } from 'next-auth'
import { GET } from '@/app/api/exams/[pageId]/state/route'

const session = getServerSession as unknown as ReturnType<typeof vi.fn>
const ctx = { params: Promise.resolve({ pageId: 'p1' }) }
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/exams/p1/state?${qs}`), ctx)

beforeEach(() => vi.clearAllMocks())

describe('GET exam state auth', () => {
  it('anonymous → 401; missing siteId → 400', async () => {
    session.mockResolvedValue(null)
    expect((await get('classId=c1&siteId=s1')).status).toBe(401)
    expect((await get('classId=c1')).status).toBe(400)
  })

  it('stranger → 403; member asking for another student → 403', async () => {
    session.mockResolvedValue({ user: { id: 'stranger' } })
    mocks.prisma.classMembership.findFirst.mockResolvedValue(null)
    expect((await get('classId=c1&siteId=s1')).status).toBe(403)
    session.mockResolvedValue({ user: { id: 'stud' } })
    mocks.prisma.classMembership.findFirst.mockResolvedValue({ id: 'm' })
    expect((await get('classId=c1&siteId=s1&studentId=other')).status).toBe(403)
  })

  it('member / teacher → 200, filtered by site', async () => {
    session.mockResolvedValue({ user: { id: 'teacher' } })
    expect((await get('classId=c1&siteId=s1')).status).toBe(200)
    expect(mocks.prisma.examState.findFirst.mock.calls[0][0].where).toMatchObject({ siteId: 's1', classId: 'c1' })
  })
})
