import { describe, it, expect, vi, beforeEach } from 'vitest'

// Site scoping rule set (src/lib/site-access.ts). Prisma is mocked; the tests
// pin the decisions: who manages a site (no admin bypass, no authorship
// grant), what counts as placement, and that read access suffices to place.

const mocks = vi.hoisted(() => ({
  prisma: {
    site: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    organizationMember: { findUnique: vi.fn() },
    pageLayoutItem: { findMany: vi.fn() },
    pageLayout: { findUnique: vi.fn() },
    collectionSkript: { findMany: vi.fn(), count: vi.fn() },
    page: { findUnique: vi.fn() },
    frontPage: { findUnique: vi.fn() },
    skript: { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import {
  getSiteAccess,
  canManageSite,
  getManagedSiteIds,
  isSkriptPlacedOnSite,
  isItemPlacedOnSite,
  getPlacementSiteIdsForSkript,
  canPlaceSkript,
} from '@/lib/site-access'

const p = mocks.prisma

beforeEach(() => {
  vi.resetAllMocks()
})

describe('canManageSite / getSiteAccess', () => {
  it('personal site: only the owner manages it', async () => {
    p.site.findUnique.mockResolvedValue({ id: 's1', userId: 'teacher-a', organizationId: null })
    expect(await getSiteAccess('teacher-a', 's1')).toEqual({ siteId: 's1', kind: 'personal', canManage: true, isOwner: true })
    expect(await canManageSite('teacher-b', 's1')).toBe(false)
    expect(p.organizationMember.findUnique).not.toHaveBeenCalled()
  })

  it('a skript co-author on another site gets nothing (authorship is not a grant)', async () => {
    // getSiteAccess never consults SkriptAuthor/PageAuthor — only Site/OrgMember.
    p.site.findUnique.mockResolvedValue({ id: 's1', userId: 'teacher-a', organizationId: null })
    expect(await canManageSite('coauthor', 's1')).toBe(false)
    expect(p.skript.count).not.toHaveBeenCalled()
  })

  it('org site: owner/admin manage, members do not; no classes (isOwner false)', async () => {
    p.site.findUnique.mockResolvedValue({ id: 'org-site', userId: null, organizationId: 'org-1' })
    p.organizationMember.findUnique.mockResolvedValueOnce({ role: 'admin' })
    expect(await getSiteAccess('admin-u', 'org-site')).toEqual({ siteId: 'org-site', kind: 'org', canManage: true, isOwner: false })
    p.organizationMember.findUnique.mockResolvedValueOnce({ role: 'owner' })
    expect(await canManageSite('owner-u', 'org-site')).toBe(true)
    p.organizationMember.findUnique.mockResolvedValueOnce({ role: 'member' })
    expect(await canManageSite('member-u', 'org-site')).toBe(false)
    p.organizationMember.findUnique.mockResolvedValueOnce(null)
    expect(await canManageSite('stranger', 'org-site')).toBe(false)
  })

  it('has no superadmin bypass (there is no isAdmin input at all)', async () => {
    p.site.findUnique.mockResolvedValue({ id: 's1', userId: 'teacher-a', organizationId: null })
    // A platform admin is just another user here.
    expect(await canManageSite('platform-admin', 's1')).toBe(false)
    expect(canManageSite.length).toBe(2)
  })

  it('anonymous / unknown site → no access', async () => {
    p.site.findUnique.mockResolvedValue(null)
    expect(await getSiteAccess('u', 'nope')).toBeNull()
    expect(await canManageSite(null, 's1')).toBe(false)
  })

  it('getManagedSiteIds covers own sites + org owner/admin sites', async () => {
    p.site.findMany.mockResolvedValue([{ id: 'a' }, { id: 'org' }])
    expect(await getManagedSiteIds('u')).toEqual(['a', 'org'])
    const where = p.site.findMany.mock.calls[0][0].where
    expect(where.OR[0]).toEqual({ userId: 'u' })
    expect(where.OR[1].organization.members.some).toEqual({ userId: 'u', role: { in: ['owner', 'admin'] } })
  })
})

describe('placement', () => {
  it('placed via a collection owned by the site', async () => {
    p.collectionSkript.count.mockResolvedValueOnce(1)
    expect(await isSkriptPlacedOnSite('sk', 's1')).toBe(true)
  })

  it('placed as a root layout item', async () => {
    p.collectionSkript.count.mockResolvedValueOnce(0)
    p.pageLayout.findUnique.mockResolvedValue({ items: [{ type: 'skript', contentId: 'sk' }] })
    expect(await isSkriptPlacedOnSite('sk', 's1')).toBe(true)
  })

  it('placed via a collection referenced by the layout (org layout → admin collection)', async () => {
    p.collectionSkript.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    p.pageLayout.findUnique.mockResolvedValue({ items: [{ type: 'collection', contentId: 'col-x' }] })
    expect(await isSkriptPlacedOnSite('sk', 's1')).toBe(true)
    expect(p.collectionSkript.count.mock.calls[1][0].where).toEqual({ skriptId: 'sk', collectionId: { in: ['col-x'] } })
  })

  it('not placed → false (page 404s on that site, writes rejected)', async () => {
    p.collectionSkript.count.mockResolvedValue(0)
    p.pageLayout.findUnique.mockResolvedValue({ items: [{ type: 'skript', contentId: 'other' }] })
    expect(await isSkriptPlacedOnSite('sk', 's1')).toBe(false)
  })

  it('a site front page belongs only to its own site', async () => {
    p.page.findUnique.mockResolvedValue(null)
    p.frontPage.findUnique.mockResolvedValue({ siteId: 's1', skriptId: null })
    expect(await isItemPlacedOnSite('fp-1', 's1')).toBe(true)
    expect(await isItemPlacedOnSite('fp-1', 's2')).toBe(false)
  })

  it('non-content item ids (e.g. "global") are allowed on any existing site', async () => {
    p.page.findUnique.mockResolvedValue(null)
    p.frontPage.findUnique.mockResolvedValue(null)
    p.skript.findUnique.mockResolvedValue(null)
    p.site.count.mockResolvedValue(1)
    expect(await isItemPlacedOnSite('global', 's1')).toBe(true)
  })

  it('getPlacementSiteIdsForSkript unions root items, owning sites and referencing layouts', async () => {
    p.pageLayoutItem.findMany
      .mockResolvedValueOnce([{ pageLayout: { siteId: 'root-site' } }])
      .mockResolvedValueOnce([{ pageLayout: { siteId: 'org-site' } }])
    p.collectionSkript.findMany.mockResolvedValue([{ collectionId: 'c1', collection: { siteId: 'owner-site' } }])
    expect((await getPlacementSiteIdsForSkript('sk')).sort()).toEqual(['org-site', 'owner-site', 'root-site'])
  })
})

describe('canPlaceSkript (rule 3: read access suffices)', () => {
  it('accepts any SkriptAuthor row (author OR viewer) or a page share — no permission filter', async () => {
    p.skript.count.mockResolvedValue(1)
    expect(await canPlaceSkript('viewer-u', 'sk')).toBe(true)
    const where = p.skript.count.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { authors: { some: { userId: 'viewer-u' } } },
      { pages: { some: { authors: { some: { userId: 'viewer-u' } } } } },
    ])
    expect(JSON.stringify(where)).not.toContain('permission')
  })

  it('rejects users without any access', async () => {
    p.skript.count.mockResolvedValue(0)
    expect(await canPlaceSkript('stranger', 'sk')).toBe(false)
  })
})
