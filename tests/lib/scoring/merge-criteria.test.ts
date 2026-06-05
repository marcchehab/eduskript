import { describe, it, expect } from 'vitest'
import { mergedCriterionTotal } from '@/lib/scoring/merge-criteria'

const rubric = ['c1', 'c2', 'c3']
const ai = [
  { id: 'c1', points: 1 },
  { id: 'c2', points: 1.5, comment: 'ok' },
  { id: 'c3', points: 0.5 },
]

describe('mergedCriterionTotal', () => {
  it('sums the AI points when there is no override', () => {
    expect(mergedCriterionTotal(rubric, ai, [])).toBe(3)
  })

  it('a points override replaces that criterion; others follow the AI', () => {
    expect(mergedCriterionTotal(rubric, ai, [{ id: 'c2', points: 0.5 }])).toBe(2) // 1 + 0.5 + 0.5
  })

  it('a comment-only override does NOT change the total', () => {
    expect(mergedCriterionTotal(rubric, ai, [{ id: 'c2', comment: 'changed' }])).toBe(3)
  })

  it('a criterion with neither AI nor override scores 0', () => {
    expect(mergedCriterionTotal(['c1', 'c2', 'c3', 'c4'], ai, [])).toBe(3)
  })

  it('pure-manual (no AI) sums the override points over the rubric', () => {
    expect(mergedCriterionTotal(rubric, [], [{ id: 'c1', points: 1 }, { id: 'c3', points: 1 }])).toBe(2)
  })

  it('returns null when nothing is scored at all', () => {
    expect(mergedCriterionTotal(rubric, [], [{ id: 'c1', comment: 'note' }])).toBeNull()
    expect(mergedCriterionTotal(rubric, [], [])).toBeNull()
  })

  it('with no rubric, totals over the union of scored ids', () => {
    expect(mergedCriterionTotal([], ai, [{ id: 'c1', points: 2 }])).toBe(4) // 2 + 1.5 + 0.5
  })

  it('override of 0 points is respected (not treated as absent)', () => {
    expect(mergedCriterionTotal(rubric, ai, [{ id: 'c1', points: 0 }])).toBe(2) // 0 + 1.5 + 0.5
  })
})
