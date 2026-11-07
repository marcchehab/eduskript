/**
 * Exam archive (src/lib/exam-records.ts): the 5-year retention date, the
 * purge, and which class a record is filed under when a class is archived
 * (a student in two classes must not have their exam moved between them).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsert = vi.fn(async (..._args: unknown[]) => ({}))
const deleteMany = vi.fn(async (..._args: unknown[]) => ({ count: 3 }))
const recordFindMany = vi.fn(async (): Promise<unknown[]> => [])

vi.mock('@/lib/prisma', () => ({
  prisma: {
    page: { findUnique: vi.fn(async () => ({ title: 'Prüfung 1', content: '# Prüfung' })) },
    user: { findUnique: vi.fn(async () => ({ name: 'student-a', studentPseudonym: 'ps-a', email: 'a@x.ch' })) },
    examSubmission: {
      findUnique: vi.fn(async () => ({ submittedAt: new Date('2026-06-01T10:00:00Z') })),
      findMany: vi.fn(async () => [
        { pageId: 'assigned', studentId: 's1', siteId: 'site' },
        { pageId: 'other', studentId: 's1', siteId: 'site' },
        { pageId: 'free', studentId: 's1', siteId: 'site' },
      ]),
    },
    class: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: `Class ${where.id}` })) },
    classMembership: {
      findMany: vi.fn(async () => [{ studentId: 's1' }]),
      findUnique: vi.fn(async () => ({ identityConsent: false })),
    },
    examState: { findMany: vi.fn(async () => [{ pageId: 'assigned' }]) },
    examAuditLog: { findMany: vi.fn(async () => []) },
    userData: { findMany: vi.fn(async () => []) },
    examRecord: {
      get upsert() { return upsert },
      get deleteMany() { return deleteMany },
      get findMany() { return recordFindMany },
    },
  },
}))
vi.mock('@/lib/site-access', () => ({ getManagedSiteIds: vi.fn(async () => ['site']) }))
vi.mock('@/lib/scoring/return-state', () => ({
  getCurrentReturn: vi.fn(async () => ({ returned: true, at: new Date('2026-07-01T00:00:00Z'), snapshot: null })),
}))
vi.mock('@/lib/scoring/review-payload', () => ({
  buildReviewScores: vi.fn(async () => ({ grade: 5, totalEarned: 8, totalMax: 10, components: [] })),
}))
vi.mock('@/lib/scoring/submissions', () => ({ readComponentSubmissions: vi.fn(async () => new Map()) }))

beforeEach(() => {
  upsert.mockClear()
  deleteMany.mockClear()
})

describe('exam records', () => {
  it('keeps a record 5 years from its return', async () => {
    const { retainUntil } = await import('@/lib/exam-records')
    expect(retainUntil(new Date('2026-07-01T00:00:00Z')).toISOString()).toBe('2031-07-01T00:00:00.000Z')
  })

  it('purges only records past their retention date', async () => {
    const { purgeExpiredExamRecords } = await import('@/lib/exam-records')
    const now = new Date('2031-07-02T00:00:00Z')
    expect(await purgeExpiredExamRecords(now)).toBe(3)
    expect(deleteMany).toHaveBeenCalledWith({ where: { retainUntil: { lt: now } } })
  })

  it('files assigned and unfiled exams under the archived class, leaves others in their class', async () => {
    recordFindMany.mockResolvedValueOnce([
      { pageId: 'assigned', studentId: 's1', siteId: 'site', classId: 'B' },
      { pageId: 'other', studentId: 's1', siteId: 'site', classId: 'B' },
    ])
    const { archiveClassExams } = await import('@/lib/exam-records')
    expect(await archiveClassExams('A', 'teacher')).toBe(3)

    const byPage = Object.fromEntries(upsert.mock.calls.map(([arg]) => {
      const a = arg as { where: { pageId_studentId_siteId: { pageId: string } }; update: { classId?: string; retainUntil: Date } }
      return [a.where.pageId_studentId_siteId.pageId, a.update]
    }))
    expect(byPage.assigned.classId).toBe('A') // assigned to A → moved to A
    expect(byPage.other.classId).toBeUndefined() // filed under B, not A's exam → stays
    expect(byPage.free.classId).toBe('A') // no record yet → A
    // Returned 2026-07-01 → kept until 2031-07-01.
    expect(byPage.free.retainUntil.toISOString()).toBe('2031-07-01T00:00:00.000Z')
  })
})
