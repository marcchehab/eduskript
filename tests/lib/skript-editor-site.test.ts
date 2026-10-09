import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bughunt #8: the editor's site (exam assign/state target) is chosen
// deterministically among placing sites — the viewer's own first — and is
// flagged ownedByViewer so another teacher's placement is never targeted.

const mocks = vi.hoisted(() => ({
  prisma: {
    skript: { findFirst: vi.fn() },
    pageLayoutItem: { findFirst: vi.fn(async () => ({ id: 'pli' })) },
    site: { findMany: vi.fn(), findUnique: vi.fn() },
  },
  placement: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/site-access', () => ({ getPlacementSiteIdsForSkript: mocks.placement }))

import { loadSkriptForEditor } from '@/lib/skript-editor-data'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.skript.findFirst.mockResolvedValue({ id: 'sk', authors: [{ userId: 'me', permission: 'author', user: {} }], collectionSkripts: [] })
})

describe('loadSkriptForEditor site', () => {
  it("prefers the viewer's own placing site over an older foreign one", async () => {
    mocks.placement.mockResolvedValue(['other', 'mine'])
    mocks.prisma.site.findMany.mockResolvedValue([
      { id: 'other', slug: 'o', organizationId: null, userId: 'coauthor' },
      { id: 'mine', slug: 'm', organizationId: null, userId: 'me' },
    ])
    const r = await loadSkriptForEditor('slug', 'me', false)
    expect(r?.site).toEqual({ id: 'mine', slug: 'm', organizationId: null, ownedByViewer: true })
  })

  it('a foreign-only placement is returned but flagged not owned', async () => {
    mocks.placement.mockResolvedValue(['other'])
    mocks.prisma.site.findMany.mockResolvedValue([{ id: 'other', slug: 'o', organizationId: null, userId: 'coauthor' }])
    const r = await loadSkriptForEditor('slug', 'me', false)
    expect(r?.site?.ownedByViewer).toBe(false)
  })
})
