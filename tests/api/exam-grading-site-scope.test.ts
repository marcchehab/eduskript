import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Site scoping for exam grading (SITE-SCOPING.md, rule 6/7/8):
//  - grading aggregates every site the viewer MANAGES (one view),
//  - submissions on sites the viewer doesn't manage never appear,
//  - co-authors / superadmins without management get 404 (no bypass),
//  - org owners/admins (no classes) see org-site submissions via classId=all.
// The DB is an in-memory fake that honours the `where` shapes the routes use.

type Row = Record<string, unknown>
const { db, finder } = vi.hoisted(() => {
  type R = Record<string, unknown>
  const db = {
    pages: [] as R[],
    submissions: [] as R[],
    userData: [] as R[],
    audit: [] as R[],
    classes: [] as R[],
    memberships: [] as R[],
    users: [] as R[],
  }
  function matches(row: R, where: R | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([k, cond]) => {
      if (cond === undefined) return true
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        const c = cond as R
        if ('in' in c) return (c.in as unknown[]).includes(row[k])
        return true // relation filters are not modelled; tests don't depend on them
      }
      return row[k] === cond
    })
  }
  const finder = (rows: () => R[]) => ({
    findMany: async (args?: { where?: R }) => rows().filter((r) => matches(r, args?.where)),
    findFirst: async (args?: { where?: R }) => rows().find((r) => matches(r, args?.where)) ?? null,
    findUnique: async (args?: { where?: R }) => rows().find((r) => matches(r, args?.where)) ?? null,
  })
  return { db, finder }
})

const mocks = vi.hoisted(() => ({ managed: new Map<string, string[]>(), placed: [] as string[] }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    page: finder(() => db.pages),
    examSubmission: finder(() => db.submissions),
    userData: finder(() => db.userData),
    examAuditLog: finder(() => db.audit),
    class: finder(() => db.classes),
    classMembership: finder(() => db.memberships),
    user: finder(() => db.users),
  },
}))
vi.mock('@/lib/site-access', () => ({
  getManagedSiteIds: vi.fn(async (userId: string) => mocks.managed.get(userId) ?? []),
  getPlacementSiteIdsForPage: vi.fn(async () => mocks.placed),
}))
// The class branch of the target list: teacher's classes (relation filters are
// not modelled by the fake, so resolve by teacherId only).
vi.mock('@/lib/scoring/auth', () => ({
  getExamClassesForTeacher: vi.fn(async (_p: string, teacherId: string) =>
    db.classes.filter((c) => c.teacherId === teacherId).map((c) => ({ id: c.id, name: c.name }))),
  getExamUrl: vi.fn(async () => null),
}))
vi.mock('@/lib/scoring/aggregate', () => ({
  computeExamGrades: vi.fn(async (_p: string, ids: string[]) => ({
    components: [],
    params: { formula: 'linear', passPercent: 60, passGrade: 4, topGrade: 6, bottomGrade: 1, roundingStep: 0.1 },
    maxPointsOverride: null,
    autoMaxPoints: 0,
    byStudent: new Map(ids.map((id) => [id, { grade: 1, totalEarned: 0, totalMax: 0, components: [] }])),
  })),
}))
vi.mock('@/lib/scoring/return-state', () => ({
  getCurrentReturnsForPage: vi.fn(async () => new Map()),
}))

import { getServerSession } from 'next-auth'
import { GET } from '@/app/api/exams/[pageId]/grading/route'
import { computeExamGrades } from '@/lib/scoring/aggregate'

const ctx = { params: Promise.resolve({ pageId: 'p1' }) }
const get = (classId: string) => GET(new NextRequest(`http://localhost/api/exams/p1/grading?classId=${classId}`), ctx)
const asUser = (id: string, extra: Row = {}) =>
  vi.mocked(getServerSession).mockResolvedValue({ user: { id, ...extra } } as never)

describe('GET /api/exams/[pageId]/grading — site scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.pages = [{ id: 'p1', skriptId: 'sk', title: 'Exam', content: '' }]
    db.users = ['s1', 's2', 's3', 'o1'].map((id) => ({ id, name: id, email: null, studentPseudonym: null }))
    db.submissions = [
      { pageId: 'p1', studentId: 's1', siteId: 'siteA', submittedAt: new Date('2026-10-01'), source: 'student' },
      { pageId: 'p1', studentId: 's2', siteId: 'siteB', submittedAt: new Date('2026-10-02'), source: 'student' },
      { pageId: 'p1', studentId: 's3', siteId: 'otherSite', submittedAt: new Date('2026-10-03'), source: 'student' },
      { pageId: 'p1', studentId: 'o1', siteId: 'orgSite', submittedAt: new Date('2026-10-04'), source: 'student' },
    ]
    db.userData = []
    db.audit = []
    db.classes = []
    db.memberships = []
    mocks.placed = ['siteA', 'siteB', 'otherSite', 'orgSite']
    mocks.managed = new Map([
      ['teacher', ['siteA', 'siteB']],
      ['orgAdmin', ['orgSite']],
    ])
  })

  it('aggregates every managed site and excludes non-managed sites', async () => {
    asUser('teacher')
    const res = await get('all')
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = body.students.map((s: { studentId: string; siteId: string }) => `${s.studentId}@${s.siteId}`).sort()
    expect(rows).toEqual(['s1@siteA', 's2@siteB'])
    // Scores are computed per student on that student's site.
    const sites = vi.mocked(computeExamGrades).mock.calls[0][2]
    expect(Object.fromEntries(sites)).toEqual({ s1: 'siteA', s2: 'siteB' })
  })

  it('returns 404 for a co-author / teacher who manages no site holding the exam', async () => {
    mocks.managed.set('coauthor', ['unrelatedSite'])
    asUser('coauthor')
    expect((await get('all')).status).toBe(404)
  })

  it('has no superadmin bypass', async () => {
    asUser('superadmin', { isAdmin: true })
    expect((await get('all')).status).toBe(404)
  })

  it('lets an org admin without classes see the org-site submissions via classId=all', async () => {
    asUser('orgAdmin')
    const body = await (await get('all')).json()
    expect(body.classes).toEqual([])
    expect(body.students.map((s: { studentId: string }) => s.studentId)).toEqual(['o1'])
  })
})
