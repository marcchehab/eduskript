import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bughunt #5: My Snaps lists each snap with the site it belongs to (so the
// delete can address that row) and links to the page on THAT site.

const mocks = vi.hoisted(() => ({
  prisma: {
    userData: { findMany: vi.fn() },
    page: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { GET } from '@/app/api/user-data/snaps/route'

beforeEach(() => vi.clearAllMocks())

describe('GET /api/user-data/snaps', () => {
  it('returns siteId + site-specific path prefix per snap and skips unsited rows', async () => {
    mocks.prisma.userData.findMany.mockResolvedValue([
      { itemId: 'p1', siteId: 'site-a', targetType: null, targetId: null, createdAt: new Date(2), data: { snaps: [{ id: 's1' }] } },
      { itemId: 'p1', siteId: 'org-site', targetType: null, targetId: null, createdAt: new Date(1), data: { snaps: [{ id: 's2' }] } },
    ])
    mocks.prisma.page.findMany.mockResolvedValue([{ id: 'p1', title: 'P', slug: 'p', skript: { title: 'S', slug: 'sk', collectionSkripts: [] } }])
    mocks.prisma.site.findMany.mockResolvedValue([
      { id: 'site-a', slug: 'alice', organizationId: null },
      { id: 'org-site', slug: 'school', organizationId: 'o1' },
    ])
    const body = await (await GET()).json()
    expect(mocks.prisma.userData.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1', siteId: { not: '' } })
    expect(body.snaps.map((s: { id: string; siteId: string; authorPageSlug: string }) => [s.id, s.siteId, s.authorPageSlug])).toEqual([
      ['s1', 'site-a', 'alice'],
      ['s2', 'org-site', 'org/school/c'],
    ])
  })
})
