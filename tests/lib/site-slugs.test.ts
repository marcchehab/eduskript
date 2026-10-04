import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  siteFindUnique: vi.fn(),
  aliasFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    site: { findUnique: mocks.siteFindUnique },
    siteSlugAlias: { findUnique: mocks.aliasFindUnique },
  },
}))

import { isSiteSlugTaken, recordSiteSlugRename, siteHasOrHadSlug } from '@/lib/site-slugs'

beforeEach(() => {
  mocks.siteFindUnique.mockReset().mockResolvedValue(null)
  mocks.aliasFindUnique.mockReset().mockResolvedValue(null)
})

describe('siteHasOrHadSlug', () => {
  it('matches the current slug or an old one', () => {
    expect(siteHasOrHadSlug('jm')).toEqual({ OR: [{ slug: 'jm' }, { slugAliases: { some: { slug: 'jm' } } }] })
  })
})

describe('isSiteSlugTaken', () => {
  it('is free when no site has or had it', async () => {
    expect(await isSiteSlugTaken('frei')).toBe(false)
  })

  it("counts another site's old slug as taken", async () => {
    mocks.aliasFindUnique.mockResolvedValue({ site: { id: 's1', userId: 'u1' } })
    expect(await isSiteSlugTaken('jm', { siteId: 's2', userId: 'u2' })).toBe(true)
  })

  it("lets a site reclaim its own old slug", async () => {
    mocks.aliasFindUnique.mockResolvedValue({ site: { id: 's1', userId: 'u1' } })
    expect(await isSiteSlugTaken('jm', { siteId: 's1' })).toBe(false)
    expect(await isSiteSlugTaken('jm', { userId: 'u1' })).toBe(false)
  })

  it("counts another site's current slug as taken", async () => {
    mocks.siteFindUnique.mockResolvedValue({ id: 's1', userId: 'u1' })
    expect(await isSiteSlugTaken('jm', { siteId: 's2' })).toBe(true)
  })
})

describe('recordSiteSlugRename', () => {
  const tx = () => ({
    siteSlugAlias: { deleteMany: vi.fn(), upsert: vi.fn() },
    $executeRaw: vi.fn(),
  })

  it('keeps the old slug as alias, drops an alias equal to the new one, rewrites plugin srcs', async () => {
    const t = tx()
    await recordSiteSlugRename(t as never, { siteId: 's1', userId: 'u1', oldSlug: 'jm', newSlug: 'menrath' })
    expect(t.siteSlugAlias.deleteMany).toHaveBeenCalledWith({ where: { slug: 'menrath', siteId: 's1' } })
    expect(t.siteSlugAlias.upsert).toHaveBeenCalledWith({
      where: { slug: 'jm' },
      create: { slug: 'jm', siteId: 's1' },
      update: { siteId: 's1' },
    })
    const values = t.$executeRaw.mock.calls[0].slice(1)
    expect(values).toEqual(['(<plugin[^>]*[[:space:]]src=")jm/', '\\1menrath/', '%src="jm/%', 'u1'])
  })

  it('does nothing when the slug did not change', async () => {
    const t = tx()
    await recordSiteSlugRename(t as never, { siteId: 's1', userId: 'u1', oldSlug: 'jm', newSlug: 'jm' })
    expect(t.siteSlugAlias.upsert).not.toHaveBeenCalled()
    expect(t.$executeRaw).not.toHaveBeenCalled()
  })
})
