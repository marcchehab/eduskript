import { describe, it, expect } from 'vitest'
import {
  gradeFromPercent,
  gradeFromPoints,
  roundToStep,
  DEFAULT_GRADE_CONFIG,
  type GradeConfigParams,
} from '@/lib/scoring/grade-formula'

const twoSeg = (passPercent: number, roundingStep = 0.1): GradeConfigParams => ({
  formula: 'twoSegment',
  passPercent,
  passGrade: 4,
  topGrade: 6,
  bottomGrade: 1,
  roundingStep,
})

const linear = (roundingStep = 0.1): GradeConfigParams => ({
  ...twoSeg(60, roundingStep),
  formula: 'linear',
})

describe('roundToStep', () => {
  it('rounds to 0.1 / 0.25 / 0.5 without float drift', () => {
    expect(roundToStep(4.27, 0.1)).toBeCloseTo(4.3, 10)
    expect(roundToStep(4.27, 0.25)).toBeCloseTo(4.25, 10)
    expect(roundToStep(4.27, 0.5)).toBeCloseTo(4.5, 10)
    expect(roundToStep(4.1, 0.5)).toBeCloseTo(4.0, 10)
  })
  it('passes through when step is 0 or negative', () => {
    expect(roundToStep(4.27, 0)).toBe(4.27)
  })
})

describe('gradeFromPercent — twoSegment', () => {
  it('lands the pass grade (4.0) exactly at passPercent (60)', () => {
    const c = twoSeg(60)
    expect(gradeFromPercent(0, c)).toBeCloseTo(1.0, 10)
    expect(gradeFromPercent(30, c)).toBeCloseTo(2.5, 10)
    expect(gradeFromPercent(60, c)).toBeCloseTo(4.0, 10)
    expect(gradeFromPercent(80, c)).toBeCloseTo(5.0, 10)
    expect(gradeFromPercent(100, c)).toBeCloseTo(6.0, 10)
  })
  it('honours a 55% pass mark (the user default)', () => {
    const c = twoSeg(55)
    expect(gradeFromPercent(55, c)).toBeCloseTo(4.0, 10)
    expect(gradeFromPercent(27.5, c)).toBeCloseTo(2.5, 10)
    expect(gradeFromPercent(77.5, c)).toBeCloseTo(5.0, 10)
  })
  it('clamps below 0% / above 100%', () => {
    const c = twoSeg(60)
    expect(gradeFromPercent(-20, c)).toBeCloseTo(1.0, 10)
    expect(gradeFromPercent(140, c)).toBeCloseTo(6.0, 10)
  })
  it('falls back to linear when passPercent is degenerate', () => {
    expect(gradeFromPercent(50, twoSeg(0))).toBeCloseTo(gradeFromPercent(50, linear()), 10)
    expect(gradeFromPercent(50, twoSeg(100))).toBeCloseTo(gradeFromPercent(50, linear()), 10)
  })
})

describe('gradeFromPercent — linear', () => {
  it('puts 4.0 at 60% with the 1–6 defaults; passPercent ignored', () => {
    const c = linear()
    expect(gradeFromPercent(0, c)).toBeCloseTo(1.0, 10)
    expect(gradeFromPercent(50, c)).toBeCloseTo(3.5, 10)
    expect(gradeFromPercent(60, c)).toBeCloseTo(4.0, 10)
    expect(gradeFromPercent(100, c)).toBeCloseTo(6.0, 10)
  })
})

describe('rounding step applied to the final grade', () => {
  it('rounds a two-segment 63% result to the chosen step', () => {
    // raw = 4 + 2*((63-60)/40) = 4.15
    expect(gradeFromPercent(63, twoSeg(60, 0.1))).toBeCloseTo(4.2, 10)
    expect(gradeFromPercent(63, twoSeg(60, 0.5))).toBeCloseTo(4.0, 10)
    expect(gradeFromPercent(63, twoSeg(60, 0.25))).toBeCloseTo(4.25, 10)
  })
})

describe('gradeFromPoints', () => {
  it('converts earned/max to a percentage then grades', () => {
    expect(gradeFromPoints(15, 50, twoSeg(60))).toBeCloseTo(2.5, 10) // 30% → 2.5
    expect(gradeFromPoints(30, 50, twoSeg(60))).toBeCloseTo(4.0, 10) // 60% → 4.0
    expect(gradeFromPoints(50, 50, twoSeg(60))).toBeCloseTo(6.0, 10) // 100% → 6.0
  })
  it('returns the bottom grade when max ≤ 0', () => {
    expect(gradeFromPoints(0, 0, twoSeg(60))).toBe(1)
  })
})

describe('DEFAULT_GRADE_CONFIG', () => {
  it('is two-segment, pass 60, 1–6, 0.1 step', () => {
    expect(DEFAULT_GRADE_CONFIG).toMatchObject({
      formula: 'twoSegment',
      passPercent: 60,
      passGrade: 4,
      topGrade: 6,
      bottomGrade: 1,
      roundingStep: 0.1,
    })
  })
})
