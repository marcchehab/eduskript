import { describe, it, expect } from 'vitest'
import { aggregateStudent, resolveConfig, type QuestionOverride } from '@/lib/grading/aggregate'
import type { GradableComponent } from '@/lib/grading/components'
import { DEFAULT_GRADE_CONFIG } from '@/lib/grading/grade-formula'

const components: GradableComponent[] = [
  { componentId: 'quiz-p1', kind: 'quiz', questionType: 'text', maxPoints: 2 },
  { componentId: 'quiz-q2', kind: 'quiz', questionType: 'single', maxPoints: 1 },
  { componentId: 'python-check-a8', kind: 'python', maxPoints: 3 },
]

describe('aggregateStudent', () => {
  it('sums auto scores and grades against summed max (two-segment default)', () => {
    const payloads = new Map<string, unknown>([
      ['quiz-p1', { isSubmitted: true, textScore: 1.5 }],
      ['quiz-q2', { isSubmitted: true, choiceScore: 1 }],
      ['python-check-a8', { earnedPoints: 3, points: 3 }],
    ])
    const r = aggregateStudent(components, payloads, new Map(), DEFAULT_GRADE_CONFIG, null)
    expect(r.totalEarned).toBeCloseTo(5.5, 10)
    expect(r.totalMax).toBe(6)
    // 5.5/6 = 91.67% → twoSegment(60): 4 + 2*((91.67-60)/40) ≈ 5.58 → 5.6
    expect(r.grade).toBeCloseTo(5.6, 10)
  })

  it('unanswered components count 0 earned but still add to max', () => {
    const r = aggregateStudent(components, new Map(), new Map(), DEFAULT_GRADE_CONFIG, null)
    expect(r.totalEarned).toBe(0)
    expect(r.totalMax).toBe(6)
    expect(r.grade).toBe(1)
    expect(r.components.every((c) => !c.answered)).toBe(true)
  })

  it('teacher override wins over the auto score', () => {
    const payloads = new Map<string, unknown>([['quiz-p1', { isSubmitted: true, textScore: 0.5 }]])
    const overrides = new Map<string, QuestionOverride>([['quiz-p1', { awardedPoints: 2 }]])
    const r = aggregateStudent(components, payloads, overrides, DEFAULT_GRADE_CONFIG, null)
    const p1 = r.components.find((c) => c.componentId === 'quiz-p1')!
    expect(p1).toMatchObject({ earned: 2, overridden: true, autoEarned: 0.5 })
    expect(r.totalEarned).toBe(2)
  })

  it('maxPoints override replaces the summed max for the grade', () => {
    const payloads = new Map<string, unknown>([['python-check-a8', { earnedPoints: 3, points: 3 }]])
    // Only 3 earned, but teacher caps max at 3 → 100% → 6.0
    const r = aggregateStudent(components, payloads, new Map(), DEFAULT_GRADE_CONFIG, 3)
    expect(r.totalMax).toBe(3)
    expect(r.totalEarned).toBe(3)
    expect(r.grade).toBe(6)
  })
})

describe('resolveConfig', () => {
  it('returns defaults when no row', () => {
    expect(resolveConfig(null)).toEqual({ params: DEFAULT_GRADE_CONFIG, maxPointsOverride: null })
  })
  it('maps a stored row, coercing an unknown formula to twoSegment', () => {
    const { params, maxPointsOverride } = resolveConfig({
      formula: 'bogus', passPercent: 55, passGrade: 4, topGrade: 6, bottomGrade: 1,
      roundingStep: 0.25, maxPoints: 30,
    } as never)
    expect(params.formula).toBe('twoSegment')
    expect(params.passPercent).toBe(55)
    expect(params.roundingStep).toBe(0.25)
    expect(maxPointsOverride).toBe(30)
  })
})
