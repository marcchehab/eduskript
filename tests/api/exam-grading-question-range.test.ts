import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Exam grading: a teacher's points per question must stay within 0..max
// (QA finding grading-points-accept-above-max-and-negative).

const mocks = vi.hoisted(() => ({
  mockPrisma: {
    componentScore: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    scoringRubric: { findUnique: vi.fn() },
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.mockPrisma }))
vi.mock('@/lib/scoring/auth', () => ({
  getAuthoredExamPage: vi.fn(async () => ({
    id: 'page-1',
    content: '## Aufgabe 1\n<question id="q1" type="text" points="3">\nWas?\n</question>\n',
  })),
  isTeacherOfStudentForPage: vi.fn(async () => true),
}))
vi.mock('@/lib/scoring/return-state', () => ({
  isStudentReturned: vi.fn(async () => false),
  returnedLockResponse: () => new Response('locked', { status: 409 }),
}))

import { getServerSession } from 'next-auth'
import { PUT } from '@/app/api/exams/[pageId]/grading/question/route'

const mockPrisma = mocks.mockPrisma
const mockSession = getServerSession as unknown as ReturnType<typeof vi.fn>

function put(body: unknown) {
  return new NextRequest('http://localhost/api/exams/page-1/grading/question', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const ctx = { params: Promise.resolve({ pageId: 'page-1' }) }

describe('PUT /api/exams/[pageId]/grading/question points range', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession.mockResolvedValue({ user: { id: 'teacher-1' } })
    mockPrisma.componentScore.findUnique.mockResolvedValue(null)
    mockPrisma.componentScore.findMany.mockResolvedValue([])
    mockPrisma.componentScore.upsert.mockResolvedValue({ id: 'g1' })
    mockPrisma.scoringRubric.findUnique.mockResolvedValue({ criteria: [{ id: 'c1', points: 2 }] })
  })

  const base = { studentId: 's1', componentId: 'quiz-q1' }

  it('rejects points above the question max', async () => {
    const res = await PUT(put({ ...base, awardedPoints: 99 }), ctx)
    expect(res.status).toBe(400)
    expect(mockPrisma.componentScore.upsert).not.toHaveBeenCalled()
  })

  it('rejects negative points', async () => {
    const res = await PUT(put({ ...base, awardedPoints: -3 }), ctx)
    expect(res.status).toBe(400)
    expect(mockPrisma.componentScore.upsert).not.toHaveBeenCalled()
  })

  it('accepts 0 and the max', async () => {
    expect((await PUT(put({ ...base, awardedPoints: 0 }), ctx)).status).toBe(200)
    expect((await PUT(put({ ...base, awardedPoints: 3 }), ctx)).status).toBe(200)
    expect(mockPrisma.componentScore.upsert).toHaveBeenCalledTimes(2)
  })

  it('rejects criterion points above the rubric criterion max or below 0', async () => {
    const over = await PUT(put({ ...base, criterion: { id: 'c1', points: 5 } }), ctx)
    expect(over.status).toBe(400)
    const neg = await PUT(put({ ...base, criterion: { id: 'c1', points: -1 } }), ctx)
    expect(neg.status).toBe(400)
    expect(mockPrisma.componentScore.upsert).not.toHaveBeenCalled()
  })

  it('accepts criterion points within the criterion max', async () => {
    const res = await PUT(put({ ...base, criterion: { id: 'c1', points: 2 } }), ctx)
    expect(res.status).toBe(200)
  })
})
