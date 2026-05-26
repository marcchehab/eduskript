import { describe, it, expect } from 'vitest'
import { scoreComponent } from '@/lib/grading/score-component'

describe('scoreComponent — python (authoritative re-run)', () => {
  it('reads the re-run result, not the client payload', () => {
    const s = scoreComponent({
      kind: 'python',
      declaredMax: 5,
      payload: { earnedPoints: 99, points: 5 }, // client value — must be ignored
      checkRun: { earned: 3, max: 5 },
    })
    expect(s).toMatchObject({ earned: 3, max: 5, answered: true, overridden: false })
  })
  it('declared max (markdown) wins over the re-run max', () => {
    const s = scoreComponent({ kind: 'python', declaredMax: 6, checkRun: { earned: 3, max: 5 } })
    expect(s.max).toBe(6)
  })
  it('falls back to the re-run max when no declared max', () => {
    const s = scoreComponent({ kind: 'python', checkRun: { earned: 2, max: 4 } })
    expect(s.max).toBe(4)
  })
  it('not run yet → earned 0, answered false (client payload never trusted)', () => {
    const s = scoreComponent({ kind: 'python', declaredMax: 4, payload: { earnedPoints: 4, points: 4 }, checkRun: null })
    expect(s).toMatchObject({ earned: 0, max: 4, answered: false })
  })
})

describe('scoreComponent — quiz text & choice (authoritative re-grade)', () => {
  it('text reads the teacher re-grade (checkRun), not the client textScore', () => {
    const s = scoreComponent({
      kind: 'quiz', questionType: 'text', declaredMax: 2,
      payload: { textScore: 99, isSubmitted: true }, // client value — must be ignored
      checkRun: { earned: 1.5, max: 2 },
    })
    expect(s).toMatchObject({ earned: 1.5, max: 2, answered: true })
  })
  it('choice reads the teacher re-grade (checkRun), not the client choiceScore', () => {
    const s = scoreComponent({
      kind: 'quiz', questionType: 'single', declaredMax: 1,
      payload: { choiceScore: 99, isSubmitted: true }, // client value — must be ignored
      checkRun: { earned: 1, max: 1 },
    })
    expect(s).toMatchObject({ earned: 1, max: 1, answered: true })
  })
  it('not yet graded (no checkRun) → earned 0, answered false (client score never trusted)', () => {
    const s = scoreComponent({
      kind: 'quiz', questionType: 'text', declaredMax: 2,
      payload: { textScore: 2, isSubmitted: true }, checkRun: null,
    })
    expect(s).toMatchObject({ earned: 0, max: 2, answered: false })
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
  it('replaces earned and marks overridden; keeps autoEarned (re-grade) for display', () => {
    const s = scoreComponent({
      kind: 'quiz',
      questionType: 'text',
      declaredMax: 2,
      payload: { textScore: 99, isSubmitted: true },
      checkRun: { earned: 0.5, max: 2 },
      override: { awardedPoints: 2 },
    })
    expect(s).toMatchObject({ earned: 2, max: 2, overridden: true, autoEarned: 0.5, answered: true })
  })
  it('override maxPoints wins over declared max', () => {
    const s = scoreComponent({
      kind: 'python',
      declaredMax: 5,
      checkRun: { earned: 3, max: 5 },
      override: { awardedPoints: 4, maxPoints: 8 },
    })
    expect(s).toMatchObject({ earned: 4, max: 8, overridden: true })
  })
})
