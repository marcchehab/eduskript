import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Site scoping for teacher reads of student data (SITE-SCOPING.md,
// src/lib/site-access.ts, src/lib/class-site-auth.ts). Uses the REAL
// site-access helpers over a mocked prisma, so the management rule itself
// (personal owner / org owner+admin, no admin bypass, authorship grants
// nothing) is exercised, not stubbed.
//
// Fixture:
//   site-a  personal, owned by teacher-a
//   site-b  personal, owned by teacher-b (co-author of the same skript)
//   site-org  org site of org-1; admin-1 is org admin, member-1 plain member

const SITES: Record<string, { id: string; userId: string | null; organizationId: string | null }> = {
  'site-a': { id: 'site-a', userId: 'teacher-a', organizationId: null },
  'site-b': { id: 'site-b', userId: 'teacher-b', organizationId: null },
  'site-org': { id: 'site-org', userId: null, organizationId: 'org-1' },
}
const ORG_ROLES: Record<string, string> = { 'admin-1': 'admin', 'member-1': 'member' }

const mocks = vi.hoisted(() => ({
  mockPrisma: {
    site: { findUnique: vi.fn(), count: vi.fn() },
    organizationMember: { findUnique: vi.fn() },
    class: { findUnique: vi.fn() },
    classMembership: { findMany: vi.fn(), findUnique: vi.fn() },
    page: { findUnique: vi.fn() },
    frontPage: { findUnique: vi.fn() },
    skript: { findUnique: vi.fn() },
    collectionSkript: { count: vi.fn() },
    pageLayout: { findUnique: vi.fn() },
    userData: { findMany: vi.fn(), findFirst: vi.fn() },
    userDataCheckpoint: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    examSession: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.mockPrisma }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/events', () => ({ eventBus: { publish: vi.fn() } }))
vi.mock('@/lib/billing', () => ({
  isPaidUser: () => true,
  paidOnlyResponse: () => new Response('paid', { status: 402 }),
}))
vi.mock('@/lib/privacy/pseudonym', () => ({ getStudentDisplayName: (p: string) => `Name ${p}` }))

import { getServerSession } from 'next-auth'
import { GET as quizResponses } from '@/app/api/classes/[id]/quiz-responses/route'
import { GET as studentUserData } from '@/app/api/classes/[id]/students/[studentId]/user-data/route'
import { GET as surveyExport } from '@/app/api/survey-responses/export/route'
import { GET as surveyMeta } from '@/app/api/pages/[id]/survey-meta/route'
import { POST as postCheckpoint, GET as listCheckpoints } from '@/app/api/user-data/checkpoints/route'

const p = mocks.mockPrisma
const session = getServerSession as unknown as ReturnType<typeof vi.fn>

function asUser(id: string, extra: Record<string, unknown> = {}) {
  session.mockResolvedValue({ user: { id, accountType: 'teacher', billingPlan: 'pro', ...extra } })
}
const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never)

beforeEach(() => {
  vi.clearAllMocks()
  p.site.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => SITES[where.id] ?? null)
  p.site.count.mockImplementation(async ({ where }: { where: { id: string } }) => (SITES[where.id] ? 1 : 0))
  p.organizationMember.findUnique.mockImplementation(
    async ({ where }: { where: { organizationId_userId: { organizationId: string; userId: string } } }) => {
      const role = ORG_ROLES[where.organizationId_userId.userId]
      return where.organizationId_userId.organizationId === 'org-1' && role ? { role } : null
    },
  )
  // A class of teacher-a, and the implicit survey class of page-1.
  p.class.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'class-a'
      ? { teacherId: 'teacher-a', isImplicit: false }
      : where.id === 'survey-class'
        ? { teacherId: null, isImplicit: true, implicitPageId: 'page-1' }
        : null,
  )
  p.classMembership.findMany.mockResolvedValue([
    { student: { id: 'stud-1', name: 'S1', studentPseudonym: 'ps1' } },
  ])
  p.classMembership.findUnique.mockResolvedValue({
    student: { id: 'stud-1', name: 'S1', email: null, studentPseudonym: 'ps1' },
    identityConsent: false,
  })
  p.userData.findMany.mockResolvedValue([])
  // page-1 lives in skript-1, placed on site-a and the org site (root items).
  p.page.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'page-1'
      ? { skriptId: 'skript-1', content: '<survey><Question id="q1"></Question></survey>', implicitSurveyClass: { id: 'survey-class', memberships: [] } }
      : null,
  )
  p.collectionSkript.count.mockResolvedValue(0)
  p.pageLayout.findUnique.mockImplementation(async ({ where }: { where: { siteId: string } }) =>
    where.siteId === 'site-a' || where.siteId === 'site-org' ? { items: [{ type: 'skript', contentId: 'skript-1' }] } : { items: [] },
  )
  p.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops))
  p.userDataCheckpoint.create.mockImplementation(async (args: { data: unknown }) => ({ id: 'cp-1', ...(args.data as object) }))
  p.userDataCheckpoint.findMany.mockResolvedValue([])
})

describe('class responses are isolated per site', () => {
  it('site owner + class teacher reads only rows of the requested site', async () => {
    asUser('teacher-a')
    const res = await quizResponses(
      req('/api/classes/class-a/quiz-responses?pageId=page-1&componentId=quiz-q1&siteId=site-a'),
      { params: Promise.resolve({ id: 'class-a' }) },
    )
    expect(res.status).toBe(200)
    const where = p.userData.findMany.mock.calls.at(-1)![0].where
    expect(where.siteId).toBe('site-a')
  })

  it('class teacher asking for ANOTHER teacher\'s site gets 403 (co-author sees nothing)', async () => {
    asUser('teacher-a')
    const res = await studentUserData(
      req('/api/classes/class-a/students/stud-1/user-data?pageId=page-1&siteId=site-b'),
      { params: Promise.resolve({ id: 'class-a', studentId: 'stud-1' }) },
    )
    expect(res.status).toBe(403)
    expect(p.userData.findMany).not.toHaveBeenCalled()
  })

  it('missing siteId → 400', async () => {
    asUser('teacher-a')
    const res = await studentUserData(
      req('/api/classes/class-a/students/stud-1/user-data?pageId=page-1'),
      { params: Promise.resolve({ id: 'class-a', studentId: 'stud-1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('student user-data filters by site', async () => {
    asUser('teacher-a')
    const res = await studentUserData(
      req('/api/classes/class-a/students/stud-1/user-data?pageId=page-1&siteId=site-a'),
      { params: Promise.resolve({ id: 'class-a', studentId: 'stud-1' }) },
    )
    expect(res.status).toBe(200)
    expect(p.userData.findMany.mock.calls[0][0].where.siteId).toBe('site-a')
  })

  it('implicit survey class is bound to its own page (bughunt #35)', async () => {
    asUser('admin-1')
    const res = await quizResponses(
      req('/api/classes/survey-class/quiz-responses?pageId=other-page&componentId=quiz-q1&siteId=site-org'),
      { params: Promise.resolve({ id: 'survey-class' }) },
    )
    expect(res.status).toBe(403)
  })

  it('implicit survey class: org admin may read the org site, plain member may not', async () => {
    asUser('admin-1')
    const ok = await quizResponses(
      req('/api/classes/survey-class/quiz-responses?pageId=page-1&componentId=quiz-q1&siteId=site-org'),
      { params: Promise.resolve({ id: 'survey-class' }) },
    )
    expect(ok.status).toBe(200)
    expect(p.userData.findMany.mock.calls.at(-1)![0].where.siteId).toBe('site-org')

    asUser('member-1')
    const denied = await quizResponses(
      req('/api/classes/survey-class/quiz-responses?pageId=page-1&componentId=quiz-q1&siteId=site-org'),
      { params: Promise.resolve({ id: 'survey-class' }) },
    )
    expect(denied.status).toBe(403)
  })
})

describe('survey results: site managers only, no admin bypass', () => {
  it('org admin exports answers of the org site only', async () => {
    asUser('admin-1')
    p.page.findUnique.mockResolvedValueOnce({
      content: '<survey><Question id="q1"></Question></survey>',
      implicitSurveyClass: { memberships: [{ student: { id: 'r1', studentPseudonym: 'abc' } }] },
    })
    const res = await surveyExport(req('/api/survey-responses/export?pageId=page-1&siteId=site-org'))
    expect(res.status).toBe(200)
    expect(p.userData.findMany.mock.calls[0][0].where.siteId).toBe('site-org')
  })

  it('superadmin who does not manage the site is refused', async () => {
    asUser('someone-else', { isAdmin: true })
    const res = await surveyExport(req('/api/survey-responses/export?pageId=page-1&siteId=site-a'))
    expect(res.status).toBe(403)
    const meta = await surveyMeta(
      req('/api/pages/page-1/survey-meta?siteId=site-a') as never,
      { params: Promise.resolve({ id: 'page-1' }) },
    )
    expect((await meta.json()).isAuthor).toBe(false)
  })

  it('co-author (teacher-b) gets nothing for site-a', async () => {
    asUser('teacher-b')
    const meta = await surveyMeta(
      req('/api/pages/page-1/survey-meta?siteId=site-a') as never,
      { params: Promise.resolve({ id: 'page-1' }) },
    )
    expect((await meta.json()).isAuthor).toBe(false)
  })
})

describe('checkpoints carry and enforce the site', () => {
  const body = { pageId: 'page-1', componentId: 'code-editor-x', kind: 'manual', payload: { files: [] } }

  it('stores siteId when the page is placed on that site', async () => {
    asUser('stud-1', { accountType: 'student' })
    const res = await postCheckpoint(req('/api/user-data/checkpoints', {
      method: 'POST', body: JSON.stringify({ ...body, siteId: 'site-a' }), headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)
    expect(p.userDataCheckpoint.create.mock.calls[0][0].data.siteId).toBe('site-a')
  })

  it('rejects a site the page is not placed on, and a missing siteId', async () => {
    asUser('stud-1', { accountType: 'student' })
    const wrong = await postCheckpoint(req('/api/user-data/checkpoints', {
      method: 'POST', body: JSON.stringify({ ...body, siteId: 'site-b' }), headers: { 'content-type': 'application/json' },
    }))
    expect(wrong.status).toBe(403)
    const missing = await postCheckpoint(req('/api/user-data/checkpoints', {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    }))
    expect(missing.status).toBe(400)
    expect(p.userDataCheckpoint.create).not.toHaveBeenCalled()
  })

  it('listing another user\'s checkpoints requires managing the site', async () => {
    asUser('teacher-b')
    const denied = await listCheckpoints(req('/api/user-data/checkpoints?pageId=page-1&siteId=site-a&studentId=stud-1'))
    expect(denied.status).toBe(403)

    asUser('teacher-a')
    const ok = await listCheckpoints(req('/api/user-data/checkpoints?pageId=page-1&siteId=site-a&studentId=stud-1'))
    expect(ok.status).toBe(200)
    expect(p.userDataCheckpoint.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'stud-1', siteId: 'site-a' })
  })
})
