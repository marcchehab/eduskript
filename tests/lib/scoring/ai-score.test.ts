import { describe, it, expect } from 'vitest'
import { parseAiScore } from '@/lib/ai/scoring'
import type { RubricCriterion } from '@/lib/ai/scoring'

const rubric: RubricCriterion[] = [
  { id: 'c1', description: 'Base case', points: 2 },
  { id: 'c2', description: 'Recursive step', points: 3 },
]

describe('parseAiScore', () => {
  it('sums clamped criteria into earned and keeps feedback', () => {
    const text = JSON.stringify({
      criteria: [
        { id: 'c1', points: 2, comment: 'ok' },
        { id: 'c2', points: 1.5 },
      ],
      feedback: 'Good start, finish the recursion.',
    })
    const r = parseAiScore(text, rubric)
    expect(r).toMatchObject({ earned: 3.5, feedback: 'Good start, finish the recursion.' })
    if ('criteria' in r) expect(r.criteria).toHaveLength(2)
  })

  it('clamps a criterion above its max (model cannot over-award)', () => {
    const text = JSON.stringify({ criteria: [{ id: 'c1', points: 99 }], feedback: '' })
    const r = parseAiScore(text, rubric)
    // c1 max is 2 → clamped to 2; empty feedback → null
    expect(r).toMatchObject({ earned: 2, feedback: null })
  })

  it('clamps negative points to 0 and drops unknown ids', () => {
    const text = JSON.stringify({
      criteria: [{ id: 'c1', points: -5 }, { id: 'cX', points: 10 }],
    })
    const r = parseAiScore(text, rubric)
    expect(r).toMatchObject({ earned: 0 })
    if ('criteria' in r) expect(r.criteria.map((c) => c.id)).toEqual(['c1'])
  })

  it('tolerates a markdown code fence around the JSON', () => {
    const text = '```json\n{"criteria":[{"id":"c2","points":3}],"feedback":"x"}\n```'
    const r = parseAiScore(text, rubric)
    expect(r).toMatchObject({ earned: 3 })
  })

  it('accepts a BARE ARRAY of criteria (minimax sometimes drops the wrapper object)', () => {
    const text = '[{"id":"c1","points":2},{"id":"c2","points":1}]'
    const r = parseAiScore(text, rubric)
    expect(r).toMatchObject({ earned: 3, feedback: null })
  })

  it('tolerates reasoning-model prose around the JSON', () => {
    const text = 'Here is the result:\n{"criteria":[{"id":"c1","points":2}],"feedback":"ok"}\nDone.'
    const r = parseAiScore(text, rubric)
    expect(r).toMatchObject({ earned: 2, feedback: 'ok' })
  })

  it('returns an error for unparseable output', () => {
    expect(parseAiScore('the answer is good', rubric)).toMatchObject({ error: expect.any(String) })
  })
})
