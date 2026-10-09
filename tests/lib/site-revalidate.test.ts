import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bughunt #4/#14: content edits invalidate EVERY placing site (personal and
// org), not only the editor's primary site.

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: { site: { findMany: vi.fn() } },
  getPlacementSiteIdsForSkript: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag, revalidatePath: mocks.revalidatePath, unstable_cache: (f: unknown) => f }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/site-access', () => ({ getPlacementSiteIdsForSkript: mocks.getPlacementSiteIdsForSkript }))

import { revalidateSkriptOnPlacingSites } from '@/lib/site-revalidate'
import { CACHE_TAGS } from '@/lib/cached-queries'

beforeEach(() => vi.clearAllMocks())

describe('revalidateSkriptOnPlacingSites', () => {
  it('invalidates every placing site, old and new skript slug, personal and org', async () => {
    mocks.getPlacementSiteIdsForSkript.mockResolvedValue(['a', 'b', 'org'])
    mocks.prisma.site.findMany.mockResolvedValue([
      { slug: 'alice', organizationId: null },
      { slug: 'bob', organizationId: null },
      { slug: 'school', organizationId: 'o1' },
    ])
    await revalidateSkriptOnPlacingSites('sk', ['old-slug', 'new-slug'], ['p1'])
    const tags = mocks.revalidateTag.mock.calls.map((c) => c[0])
    for (const site of ['alice', 'bob']) {
      expect(tags).toContain(CACHE_TAGS.teacherContent(site))
      expect(tags).toContain(CACHE_TAGS.skriptBySlug(site, 'old-slug'))
      expect(tags).toContain(CACHE_TAGS.skriptBySlug(site, 'new-slug'))
      expect(tags).toContain(CACHE_TAGS.pageBySlug(site, 'new-slug', 'p1'))
    }
    expect(tags).toContain(CACHE_TAGS.orgContent('school'))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/org/school/c/old-slug/p1')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/bob/new-slug/p1')
  })

  it('uses preloaded sites (delete path: placement already gone)', async () => {
    await revalidateSkriptOnPlacingSites('sk', ['s'], [], [{ slug: 'alice', organizationId: null }])
    expect(mocks.getPlacementSiteIdsForSkript).not.toHaveBeenCalled()
    expect(mocks.revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.skriptBySlug('alice', 's'), { expire: 0 })
  })
})
