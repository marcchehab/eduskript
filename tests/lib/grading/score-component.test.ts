import { describe, it, expect } from 'vitest'
import { scoreComponent } from '@/lib/grading/score-component'

describe('scoreComponent — python', () => {
  it('reads earnedPoints + points', () => {
    const s = scoreComponent({ kind: 'python', declaredMax: 5, payload: { earnedPoints: 3, points: 5 } })
    expect(s).toMatchObject({ earned: 3, max: 5, answered: true, overridden: false })
  })
  it('declared max (markdown) wins over payload.points', () => {
    const s = scoreComponent({ kind: 'python', declaredMax: 6, payload: { earnedPoints: 3, points: 5 } })
    expect(s.max).toBe(6)
  })
  it('falls back to payload.points when no declared max', () => {
    const s = scoreComponent({ kind: 'python', payload: { earnedPoints: 2, points: 4 } })
    expect(s.max).toBe(4)
  })
})

describe('scoreComponent — quiz text & choice', () => {
  it('text uses textScore', () => {
    const s = scoreComponent({ kind: 'quiz', questionType: 'text', declaredMax: 2, payload: { textScore: 1.5, isSubmitted: true } })
    expect(s).toMatchObject({ earned: 1.5, max: 2, answered: true })
  })
  it('choice uses choiceScore', () => {
    const s = scoreComponent({ kind: 'quiz', questionType: 'single', declaredMax: 1, payload: { choiceScore: 1, isSubmitted: true } })
    expect(s).toMatchObject({ earned: 1, max: 1, answered: true })
  })
  it('number/range have no auto score (answered=false, earned 0)', () => {
    const s = scoreComponent({ kind: 'quiz', questionType: 'number', declaredMax: 3, payload: { numberAnswer: 5, isSubmitted: true } })
    expect(s).toMatchObject({ earned: 0, max: 3, answered: false })
  })
})

describe('scoreComponent — unanswered', () => {
  it('null payload → earned 0, answered false, max from declared', () => {
    const s = scoreComponent({ kind: 'quiz', questionType: 'text', declaredMax: 2, payload: null })
    expect(s).toMatchObject({ earned: 0, max: 2, answered: false, overridden: false })
  })
  it('defaults max to 1 when nothing declares it', () => {
    expect(scoreComponent({ kind: 'quiz', questionType: 'single', payload: null }).max).toBe(1)
  })
})

describe('scoreComponent — teacher override wins', () => {
  it('replaces earned and marks overridden; keeps autoEarned for display', () => {
    const s = scoreComponent({
      kind: 'quiz',
      questionType: 'text',
      declaredMax: 2,
      payload: { textScore: 0.5, isSubmitted: true },
      override: { awardedPoints: 2 },
    })
    expect(s).toMatchObject({ earned: 2, max: 2, overridden: true, autoEarned: 0.5, answered: true })
  })
  it('override maxPoints wins over declared max', () => {
    const s = scoreComponent({
      kind: 'python',
      declaredMax: 5,
      payload: { earnedPoints: 3, points: 5 },
      override: { awardedPoints: 4, maxPoints: 8 },
    })
    expect(s).toMatchObject({ earned: 4, max: 8, overridden: true })
  })
})
