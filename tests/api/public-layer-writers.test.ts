import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #30/#34/#45: a site's public layer = rows written by its managers;
// '' (unplaced) has none; DELETE only removes personal rows.

const mocks = vi.hoisted(() => ({
  prisma: { userData: { findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() } },
  managers: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/site-access', () => ({ getSiteManagerIds: mocks.managers }))
vi.mock('next/cache', () => ({ unstable_cache: (f: () => unknown) => f, revalidateTag: vi.fn() }))

import { getServerSession } from 'next-auth'
import { GET, DELETE } from '@/app/api/user-data/[adapter]/[itemId]/route'
import { getPublicLayers } from '@/lib/public-page-data'

const session = getServerSession as unknown as ReturnType<typeof vi.fn>
const ctx = { params: Promise.resolve({ adapter: 'annotations', itemId: 'page-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.userData.findFirst.mockResolvedValue(null)
  mocks.prisma.userData.findMany.mockResolvedValue([])
})

describe('public layer = site managers\' rows', () => {
  it('getPublicLayers filters by the site managers', async () => {
    mocks.managers.mockResolvedValue(['owner'])
    await getPublicLayers('page-1', 'site-a')
    expect(mocks.prisma.userData.findMany.mock.calls[0][0].where).toMatchObject({ siteId: 'site-a', userId: { in: ['owner'] } })
  })

  it('page-target GET filters by managers and ignores a non-manager caller\'s own row', async () => {
    session.mockResolvedValue({ user: { id: 'student' } })
    mocks.managers.mockResolvedValue(['owner'])
    await GET(new NextRequest('http://localhost/api/user-data/annotations/page-1?targetType=page&targetId=page-1&siteId=site-a'), ctx)
    expect(mocks.prisma.userData.findFirst).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.userData.findFirst.mock.calls[0][0].where).toMatchObject({ siteId: 'site-a', userId: { in: ['owner'] } })
  })

  it('empty siteId has no public layer (#34)', async () => {
    session.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/user-data/annotations/page-1?targetType=page&targetId=page-1&siteId='), ctx)
    expect((await res.json()).data).toBeNull()
    expect(mocks.prisma.userData.findFirst).not.toHaveBeenCalled()
  })

  it('DELETE only removes personal rows (#45)', async () => {
    session.mockResolvedValue({ user: { id: 'u1' } })
    await DELETE(new NextRequest('http://localhost/api/user-data/annotations/page-1?siteId=site-a', { method: 'DELETE' }), ctx)
    expect(mocks.prisma.userData.deleteMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1', siteId: 'site-a', targetType: null })
  })
})
