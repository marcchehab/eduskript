import { describe, it, expect, beforeEach, vi } from 'vitest'

// src/lib/scoring/site-scope.ts — the teacher-side exam scope.

const m = vi.hoisted(() => ({
  page: vi.fn(),
  subs: vi.fn(),
  data: vi.fn(),
  audit: vi.fn(),
  managed: vi.fn(),
  placed: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    page: { findUnique: m.page },
    examSubmission: { findMany: m.subs },
    userData: { findMany: m.data },
    examAuditLog: { findMany: m.audit },
  },
}))
vi.mock('@/lib/site-access', () => ({
  getManagedSiteIds: m.managed,
  getPlacementSiteIdsForPage: m.placed,
}))
vi.mock('@/lib/scoring/auth', () => ({ getExamClassesForTeacher: vi.fn(async () => []) }))

import { getExamScope, resolveStudentSites, resolveStudentSite } from '@/lib/scoring/site-scope'

describe('getExamScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.page.mockResolvedValue({ id: 'p1', skriptId: 'sk', title: 't', content: '' })
    m.subs.mockResolvedValue([])
    m.data.mockResolvedValue([])
  })

  it('is managed sites ∩ (placement ∪ data sites)', async () => {
    m.managed.mockResolvedValue(['b', 'a', 'z'])
    m.placed.mockResolvedValue(['a', 'other'])
    m.subs.mockResolvedValue([{ siteId: 'b' }])
    const scope = await getExamScope('u', 'p1')
    expect(scope?.siteIds).toEqual(['a', 'b'])
  })

  it('is null for a viewer who manages no relevant site (authorship grants nothing)', async () => {
    m.managed.mockResolvedValue(['mine'])
    m.placed.mockResolvedValue(['theirs'])
    expect(await getExamScope('coauthor', 'p1')).toBeNull()
  })

  it('rejects an explicit site outside the scope', async () => {
    m.managed.mockResolvedValue(['a'])
    m.placed.mockResolvedValue(['a'])
    const scope = (await getExamScope('u', 'p1'))!
    expect(await resolveStudentSite(scope, 'p1', 's1', 'notMine')).toBeNull()
    expect(await resolveStudentSite(scope, 'p1', 's1', 'a')).toBe('a')
  })
})

describe('resolveStudentSites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefers the latest submission, then live data, then audit, then the first scope site', async () => {
    m.subs.mockResolvedValue([{ studentId: 's1', siteId: 'b' }])
    m.data.mockResolvedValue([{ userId: 's1', siteId: 'a' }, { userId: 's2', siteId: 'b' }])
    m.audit.mockResolvedValue([{ studentId: 's3', siteId: 'b' }])
    const map = await resolveStudentSites('p1', ['s1', 's2', 's3', 's4'], ['a', 'b'])
    expect(Object.fromEntries(map)).toEqual({ s1: 'b', s2: 'b', s3: 'b', s4: 'a' })
  })
})
