import { describe, it, expect } from 'vitest'
import { scoreComponent, SCORE_PRIORITY, type ScoreSource } from '@/lib/scoring/score-component'

const check = (earned: number | null, max?: number, feedback?: string): ScoreSource => ({
  source: 'check',
  priority: SCORE_PRIORITY.check,
  earned,
  max,
  feedback,
})
const ai = (earned: number | null, max?: number, feedback?: string): ScoreSource => ({
  source: 'ai',
  priority: SCORE_PRIORITY.ai,
  earned,
  max,
  feedback,
})
const override = (earned: number | null, max?: number, feedback?: string): ScoreSource => ({
  source: 'override',
  priority: SCORE_PRIORITY.override,
  earned,
  max,
  feedback,
})

describe('scoreComponent — single source', () => {
  it('reads the only source', () => {
    const s = scoreComponent({ declaredMax: 5, sources: [check(3, 5)] })
    expect(s).toMatchObject({ earned: 3, max: 5, answered: true, overridden: false, effectiveSource: 'check' })
  })
  it('declared max (markdown) wins over the source max', () => {
    expect(scoreComponent({ declaredMax: 6, sources: [check(3, 5)] }).max).toBe(6)
  })
  it('falls back to the source max when no declared max', () => {
    expect(scoreComponent({ sources: [check(2, 4)] }).max).toBe(4)
  })
  it('no sources → earned 0, answered false, max defaults to 1', () => {
    const s = scoreComponent({ sources: [] })
    expect(s).toMatchObject({ earned: 0, max: 1, answered: false, overridden: false, effectiveSource: null })
  })
  it('no scored source → unanswered, but declared max still applies', () => {
    const s = scoreComponent({ declaredMax: 3, sources: [] })
    expect(s).toMatchObject({ earned: 0, max: 3, answered: false })
  })
})

describe('scoreComponent — priority resolution (override > ai > check)', () => {
  it('AI wins over check by default', () => {
    const s = scoreComponent({ declaredMax: 5, sources: [check(2, 5), ai(4, 5)] })
    expect(s).toMatchObject({ earned: 4, effectiveSource: 'ai', overridden: false, autoEarned: 2 })
  })
  it('override wins over both ai and check', () => {
    const s = scoreComponent({ declaredMax: 5, sources: [check(2, 5), ai(4, 5), override(5, 5)] })
    expect(s).toMatchObject({ earned: 5, effectiveSource: 'override', overridden: true, autoEarned: 2 })
  })
  it('autoEarned always reflects the check source regardless of who wins', () => {
    const s = scoreComponent({ declaredMax: 5, sources: [check(1.5, 5), override(5)] })
    expect(s.autoEarned).toBe(1.5)
  })
  it('override max wins over declared max', () => {
    const s = scoreComponent({ declaredMax: 5, sources: [check(3, 5), override(4, 8)] })
    expect(s).toMatchObject({ earned: 4, max: 8, overridden: true })
  })
  it('equal priority breaks to the most recently updated row', () => {
    const older: ScoreSource = { source: 'ai', priority: 20, earned: 2, updatedAt: 1000 }
    const newer: ScoreSource = { source: 'ai', priority: 20, earned: 9, updatedAt: 2000 }
    expect(scoreComponent({ sources: [older, newer] }).earned).toBe(9)
  })
})

describe('scoreComponent — feedback resolves independently of points', () => {
  it('a points-less override row contributes feedback while check keeps the points', () => {
    const feedbackOnly = override(null, undefined, 'Nice approach, watch the edge case.')
    const s = scoreComponent({ declaredMax: 2, sources: [check(1.5, 2), feedbackOnly] })
    expect(s).toMatchObject({ earned: 1.5, overridden: false, effectiveSource: 'check', answered: true })
    expect(s.feedback).toBe('Nice approach, watch the edge case.')
  })
  it('AI feedback shows even when the teacher only overrode points', () => {
    const s = scoreComponent({
      declaredMax: 5,
      sources: [ai(3, 5, 'Partial: missing the base case.'), override(5)],
    })
    expect(s).toMatchObject({ earned: 5, effectiveSource: 'override' })
    expect(s.feedback).toBe('Partial: missing the base case.')
  })
  it('highest-priority feedback wins when several have notes', () => {
    const s = scoreComponent({
      declaredMax: 5,
      sources: [ai(3, 5, 'AI note'), override(4, 5, 'Teacher note')],
    })
    expect(s.feedback).toBe('Teacher note')
  })
  it('no feedback anywhere → null', () => {
    expect(scoreComponent({ sources: [check(1, 2)] }).feedback).toBeNull()
  })
})
