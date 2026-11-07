/**
 * Grading uses the page version each student handed in (exam-version.ts):
 * after the teacher edits the exam, a student who wrote the old version is
 * still graded on the old tasks and points.
 */

import { describe, it, expect, vi } from 'vitest'

const OLD = '## A1\n<question id="q1" type="text" points="4">\nAlt?\n</question>\n'
const NEW = '## A1\n<question id="q1" type="text" points="2">\nNeu?\n</question>\n\n## A2\n<question id="q2" type="text" points="3">\nNeu 2?\n</question>\n'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    page: { findUnique: vi.fn(async () => ({ content: NEW })) },
    examSubmission: {
      findMany: vi.fn(async () => [
        { studentId: 'old', siteId: 's', pageVersion: 3 },
        { studentId: 'gone', siteId: 's', pageVersion: 99 },
      ]),
    },
    pageVersion: { findMany: vi.fn(async () => [{ version: 3, content: OLD }]) },
    examGradeConfig: { findUnique: vi.fn(async () => null) },
    componentScore: { findMany: vi.fn(async () => []) },
  },
}))

describe('grading by handed-in version', () => {
  it('grades each student on the components of their version', async () => {
    const { computeExamGrades } = await import('@/lib/scoring/aggregate')
    const sites = new Map([['old', 's'], ['new', 's'], ['gone', 's']])
    const g = await computeExamGrades('p', ['old', 'new', 'gone'], sites)

    // Columns: the live page.
    expect(g.components.map((c) => c.componentId)).toEqual(['quiz-q1', 'quiz-q2'])
    // Handed in version 3: one task, 4 points.
    expect(g.byStudent.get('old')!.components.map((c) => c.componentId)).toEqual(['quiz-q1'])
    expect(g.byStudent.get('old')!.totalMax).toBe(4)
    // No version recorded, or the version no longer exists: the live page.
    expect(g.byStudent.get('new')!.totalMax).toBe(5)
    expect(g.byStudent.get('gone')!.totalMax).toBe(5)
  })
})
