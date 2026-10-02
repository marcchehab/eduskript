import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockPrisma: { examSubmission: { findMany: vi.fn() } },
  getCurrentReturnsForStudent: vi.fn(),
  computeExamGrades: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.mockPrisma }))
vi.mock('@/lib/scoring/return-state', () => ({
  getCurrentReturnsForStudent: mocks.getCurrentReturnsForStudent,
}))
vi.mock('@/lib/scoring/aggregate', () => ({ computeExamGrades: mocks.computeExamGrades }))

import { getServerSession } from 'next-auth'
import { GET } from '@/app/api/student/my-exams/route'

const sub = (pageId: string) => ({
  pageId,
  submittedAt: new Date('2026-10-01T08:00:00Z'),
  page: { title: `Exam ${pageId}`, slug: pageId, skript: null },
})

describe('GET /api/student/my-exams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'stu1' } } as never)
  })

  it('includes grade and points for returned exams, none for pending ones', async () => {
    mocks.mockPrisma.examSubmission.findMany.mockResolvedValue([sub('p1'), sub('p2')])
    mocks.getCurrentReturnsForStudent.mockResolvedValue(
      new Map([
        ['p1', { returned: true, score: 10, at: new Date('2026-10-02T08:00:00Z'), by: 't1', grade: 4.3, totalEarned: 10, totalMax: 15 }],
      ]),
    )
    const body = await (await GET()).json()
    const p1 = body.exams.find((e: { pageId: string }) => e.pageId === 'p1')
    const p2 = body.exams.find((e: { pageId: string }) => e.pageId === 'p2')
    expect(p1).toMatchObject({ status: 'returned', grade: 4.3, totalEarned: 10, totalMax: 15 })
    expect(p2).toMatchObject({ status: 'submitted', grade: null, totalEarned: null, totalMax: null })
  })

  it('falls back to a live recompute for legacy returns without a snapshot', async () => {
    mocks.mockPrisma.examSubmission.findMany.mockResolvedValue([sub('p1')])
    mocks.getCurrentReturnsForStudent.mockResolvedValue(
      new Map([
        ['p1', { returned: true, score: null, at: new Date(), by: null, grade: null, totalEarned: null, totalMax: null }],
      ]),
    )
    mocks.computeExamGrades.mockResolvedValue({
      components: [],
      byStudent: new Map([['stu1', { grade: 5, totalEarned: 12, totalMax: 15, components: [] }]]),
    })
    const body = await (await GET()).json()
    expect(body.exams[0]).toMatchObject({ grade: 5, totalEarned: 12, totalMax: 15 })
    expect(mocks.computeExamGrades).toHaveBeenCalledWith('p1', ['stu1'])
  })
})
