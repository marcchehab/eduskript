import { describe, it, expect } from 'vitest'
import { aggregateStudent, resolveConfig } from '@/lib/scoring/aggregate'
import type { GradableComponent } from '@/lib/scoring/components'
import { SCORE_PRIORITY, type ScoreSource } from '@/lib/scoring/score-component'
import { DEFAULT_GRADE_CONFIG } from '@/lib/scoring/grade-formula'

const components: GradableComponent[] = [
  { componentId: 'quiz-p1', kind: 'quiz', questionType: 'text', maxPoints: 2 },
  { componentId: 'quiz-q2', kind: 'quiz', questionType: 'single', maxPoints: 1 },
  { componentId: 'python-check-a8', kind: 'python', maxPoints: 3 },
]

/** Build a component->sources map from a compact [source, earned, max?] spec. */
function sources(
  spec: Record<string, Array<[string, number | null, number?]>>,
): Map<string, ScoreSource[]> {
  const m = new Map<string, ScoreSource[]>()
  for (const [componentId, rows] of Object.entries(spec)) {
    m.set(
      componentId,
      rows.map(([source, earned, max]) => ({
        source,
        priority: SCORE_PRIORITY[source] ?? 0,
        earned,
        max,
      })),
    )
  }
  return m
}

describe('aggregateStudent', () => {
  it('sums effective scores and grades against summed max (two-segment default)', () => {
    // Per-question points come from ComponentScore sources (here all "check").
    const r = aggregateStudent(
      components,
      sources({
        'quiz-p1': [['check', 1.5, 2]],
        'quiz-q2': [['check', 1, 1]],
        'python-check-a8': [['check', 3, 3]],
      }),
      DEFAULT_GRADE_CONFIG,
      null,
    )
    expect(r.totalEarned).toBeCloseTo(5.5, 10)
    expect(r.totalMax).toBe(6)
    // 5.5/6 = 91.67% → twoSegment(60): 4 + 2*((91.67-60)/40) ≈ 5.58 → 5.6
    expect(r.grade).toBeCloseTo(5.6, 10)
  })

  it('unanswered components count 0 earned but still add to max', () => {
    const r = aggregateStudent(components, new Map(), DEFAULT_GRADE_CONFIG, null)
    expect(r.totalEarned).toBe(0)
    expect(r.totalMax).toBe(6)
    expect(r.grade).toBe(1)
    expect(r.components.every((c) => !c.answered)).toBe(true)
  })

  it('teacher override wins over the check score', () => {
    const r = aggregateStudent(
      components,
      sources({ 'quiz-p1': [['check', 0.5, 2], ['override', 2, 2]] }),
      DEFAULT_GRADE_CONFIG,
      null,
    )
    const p1 = r.components.find((c) => c.componentId === 'quiz-p1')!
    expect(p1).toMatchObject({ earned: 2, overridden: true, autoEarned: 0.5, effectiveSource: 'override' })
    expect(r.totalEarned).toBe(2)
  })

  it('AI score wins over the check score by default', () => {
    const r = aggregateStudent(
      components,
      sources({ 'python-check-a8': [['check', 1, 3], ['ai', 2.5, 3]] }),
      DEFAULT_GRADE_CONFIG,
      null,
    )
    const a8 = r.components.find((c) => c.componentId === 'python-check-a8')!
    expect(a8).toMatchObject({ earned: 2.5, effectiveSource: 'ai', overridden: false, autoEarned: 1 })
  })

  it('maxPoints override replaces the summed max for the grade', () => {
    // Only 3 earned, but teacher caps max at 3 → 100% → 6.0
    const r = aggregateStudent(
      components,
      sources({ 'python-check-a8': [['check', 3, 3]] }),
      DEFAULT_GRADE_CONFIG,
      3,
    )
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
