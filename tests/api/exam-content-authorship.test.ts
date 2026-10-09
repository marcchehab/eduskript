import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Bughunt #1/#3 (rule 1): rubric + grade key are exam CONTENT. Writes need
// page authorship; reads are allowed for authors and managers of a placing
// site. A viewer who merely placed the skript cannot rewrite them.

const mocks = vi.hoisted(() => ({
  prisma: {
    page: { findUnique: vi.fn() },
    examGradeConfig: { upsert: vi.fn(async () => ({})) },
    scoringRubric: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})), deleteMany: vi.fn() },
  },
  managed: [] as string[],
  placed: [] as string[],
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/site-access', () => ({
  getManagedSiteIds: vi.fn(async () => mocks.managed),
  getPlacementSiteIdsForPage: vi.fn(async () => mocks.placed),
}))
vi.mock('@/lib/scoring/return-state', () => ({
  examHasReturnedStudent: vi.fn(async () => false),
  returnedLockResponse: () => new Response('locked', { status: 409 }),
}))
vi.mock('@/lib/billing', () => ({ isPaidUser: () => true, paidOnlyResponse: () => new Response('', { status: 402 }) }))
vi.mock('@/lib/ai/guidance', () => ({ loadAiGuidance: vi.fn(async () => '') }))

import { getServerSession } from 'next-auth'
import { PUT as putConfig } from '@/app/api/exams/[pageId]/grading/config/route'
import { GET as getRubric, PUT as putRubric } from '@/app/api/exams/[pageId]/scoring/rubric/route'

const p = mocks.prisma
const session = getServerSession as unknown as ReturnType<typeof vi.fn>
const ctx = { params: Promise.resolve({ pageId: 'page-1' }) }
const req = (method: string, body?: unknown, qs = '') =>
  new NextRequest(`http://localhost/api/exams/page-1/x${qs}`, { method, body: body ? JSON.stringify(body) : undefined })

function pageWith(authors: Array<{ userId: string; permission: string }>, skriptAuthors: Array<{ userId: string; permission: string }> = []) {
  p.page.findUnique.mockResolvedValue({ authors, skript: { authors: skriptAuthors } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.managed = []
  mocks.placed = []
})

describe('exam content writes require authorship', () => {
  it('a viewer who placed the skript on their own site cannot change the grade key or rubric', async () => {
    session.mockResolvedValue({ user: { id: 'placer' } })
    pageWith([], [{ userId: 'author', permission: 'author' }, { userId: 'placer', permission: 'viewer' }])
    mocks.managed = ['placer-site']
    mocks.placed = ['placer-site']
    expect((await putConfig(req('PUT', { formula: 'linear' }), ctx)).status).toBe(403)
    expect((await putRubric(req('PUT', { componentId: 'quiz-q1', criteria: [] }), ctx)).status).toBe(403)
    expect(p.examGradeConfig.upsert).not.toHaveBeenCalled()
    expect(p.scoringRubric.upsert).not.toHaveBeenCalled()
  })

  it('...but may READ the rubric (grading on a placing site)', async () => {
    session.mockResolvedValue({ user: { id: 'placer' } })
    pageWith([], [{ userId: 'placer', permission: 'viewer' }])
    mocks.managed = ['placer-site']
    mocks.placed = ['placer-site']
    expect((await getRubric(req('GET'), ctx)).status).toBe(200)
  })

  it('a skript author who manages no site holding the exam can still write it', async () => {
    session.mockResolvedValue({ user: { id: 'author' } })
    pageWith([], [{ userId: 'author', permission: 'author' }])
    expect((await putConfig(req('PUT', { formula: 'linear' }), ctx)).status).toBe(200)
    expect((await putRubric(req('PUT', { componentId: 'quiz-q1', criteria: [{ description: 'x', points: 1 }] }), ctx)).status).toBe(200)
  })

  it('a page-level viewer row overrides skript authorship (checkPagePermissions semantics)', async () => {
    session.mockResolvedValue({ user: { id: 'u' } })
    pageWith([{ userId: 'u', permission: 'viewer' }], [{ userId: 'u', permission: 'author' }])
    expect((await putConfig(req('PUT', {}), ctx)).status).toBe(403)
  })

  it('a stranger can neither read nor write', async () => {
    session.mockResolvedValue({ user: { id: 'stranger', isAdmin: true } })
    pageWith([], [{ userId: 'author', permission: 'author' }])
    mocks.managed = ['other-site']
    mocks.placed = ['placer-site']
    expect((await getRubric(req('GET'), ctx)).status).toBe(404)
    expect((await putConfig(req('PUT', {}), ctx)).status).toBe(403)
  })
})
