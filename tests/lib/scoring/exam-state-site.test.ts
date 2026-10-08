import { describe, it, expect, beforeEach, vi } from 'vitest'

// resolveExamStateDetail only counts ExamState rows assigned ON the site the
// student is on (site scoping): an exam opened for the class on site A stays
// hidden on site B.

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { examState: { findFirst: mocks.findFirst, findMany: mocks.findMany } },
}))

import { resolveExamStateDetail } from '@/lib/exam-state'

const rows = [
  { state: 'open', classId: 'c1', siteId: 'siteA', studentId: null },
]

describe('resolveExamStateDetail site filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue(null)
    mocks.findMany.mockImplementation(async ({ where }: { where: { siteId: string } }) =>
      rows.filter((r) => r.siteId === where.siteId))
  })

  it('sees the assignment on its own site', async () => {
    const r = await resolveExamStateDetail('p1', 's1', 'siteA')
    expect(r).toMatchObject({ state: 'open', classId: 'c1' })
  })

  it('ignores rows of other sites', async () => {
    const r = await resolveExamStateDetail('p1', 's1', 'siteB')
    expect(r.state).toBe('hidden')
    expect(mocks.findFirst.mock.calls[0][0].where.siteId).toBe('siteB')
    expect(mocks.findMany.mock.calls[0][0].where.siteId).toBe('siteB')
  })
})
