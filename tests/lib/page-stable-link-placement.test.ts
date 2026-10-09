import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bughunt #7/#15: /p/{id} and in-content links resolve to a site that PLACES
// the skript (preferring the linking page's site), never to a site that 404s.

const mocks = vi.hoisted(() => ({
  prisma: { page: { findMany: vi.fn() }, site: { findMany: vi.fn() } },
  getPlacementSiteIdsForSkript: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/site-access', () => ({ getPlacementSiteIdsForSkript: mocks.getPlacementSiteIdsForSkript }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }))

import { resolveStableLinks } from '@/lib/page-stable-link.server'

const page = { id: 'p1', slug: 'intro', title: 'Intro', skript: { id: 'sk', slug: 'algebra', authors: [{ userId: 'author' }] } }
const sites = [
  { id: 'org', slug: 'school', userId: null, organizationId: 'o1', createdAt: new Date(1) },
  { id: 'a', slug: 'author-site', userId: 'author', organizationId: null, createdAt: new Date(2) },
  { id: 'b', slug: 'bob', userId: 'bob', organizationId: null, createdAt: new Date(3) },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.page.findMany.mockResolvedValue([page])
})

describe('resolveStableLinks (placement)', () => {
  it("prefers the linking page's site when it places the target", async () => {
    mocks.getPlacementSiteIdsForSkript.mockResolvedValue(['org', 'a', 'b'])
    mocks.prisma.site.findMany.mockResolvedValue(sites)
    expect((await resolveStableLinks(['p1'], 'bob')).get('p1')?.url).toBe('/bob/algebra/intro')
    expect((await resolveStableLinks(['p1'], 'school')).get('p1')?.url).toBe('/org/school/c/algebra/intro')
  })

  it("else the author's own placing site, else the oldest placing site", async () => {
    mocks.getPlacementSiteIdsForSkript.mockResolvedValue(['org', 'a', 'b'])
    mocks.prisma.site.findMany.mockResolvedValue(sites)
    expect((await resolveStableLinks(['p1'], 'elsewhere')).get('p1')?.url).toBe('/author-site/algebra/intro')
    mocks.getPlacementSiteIdsForSkript.mockResolvedValue(['org', 'b'])
    mocks.prisma.site.findMany.mockResolvedValue([sites[0], sites[2]])
    expect((await resolveStableLinks(['p1'])).get('p1')?.url).toBe('/org/school/c/algebra/intro')
  })

  it('a skript placed nowhere does not resolve (the author primary site would 404)', async () => {
    mocks.getPlacementSiteIdsForSkript.mockResolvedValue([])
    expect((await resolveStableLinks(['p1'])).has('p1')).toBe(false)
  })
})
