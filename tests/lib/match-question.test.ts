import { describe, it, expect } from 'vitest'
import {
  answeredRowCount,
  formatMatchAnswer,
  matchResult,
  matchTargets,
  parseMatchQuestionMarkdown,
  sanitizeMatchAnswer,
} from '@/lib/match-question'
import { parseGradableComponents } from '@/lib/scoring/components'
import { scoreFromRatio } from '@/lib/output-comparison'

const BODY = `
Ordnen Sie jeder Funktion die passende Parabel zu.
<answer match="Parabel 10">$f(x)=x^2-1$</answer>
<answer match="Parabel 2">$f(x)=x^2-5$</answer>
<answer match=" Parabel 2 " feedback="Nach oben.">$f(x)=x^2+3$</answer>
<answer match="Parabel 1"></answer>
<answer>ohne match</answer>
`

describe('matchTargets', () => {
  it('dedupes, trims and sorts naturally', () => {
    expect(matchTargets(['Parabel 10', 'Parabel 2', ' Parabel 2 ', 'Parabel 1', '', undefined])).toEqual([
      'Parabel 1',
      'Parabel 2',
      'Parabel 10',
    ])
  })
})

describe('parseMatchQuestionMarkdown', () => {
  it('rows = answers with match and content; distractors only add targets', () => {
    const { rows, targets } = parseMatchQuestionMarkdown(BODY)
    expect(rows).toEqual([
      { label: '$f(x)=x^2-1$', match: 'Parabel 10' },
      { label: '$f(x)=x^2-5$', match: 'Parabel 2' },
      { label: '$f(x)=x^2+3$', match: 'Parabel 2' },
    ])
    expect(targets).toEqual(['Parabel 1', 'Parabel 2', 'Parabel 10'])
  })

  it('accepts self-closing distractors and single quotes', () => {
    const { rows, targets } = parseMatchQuestionMarkdown(`<answer match='B'>x</answer><answer match="A" />`)
    expect(rows).toEqual([{ label: 'x', match: 'B' }])
    expect(targets).toEqual(['A', 'B'])
  })
})

describe('matchResult (partial credit)', () => {
  const key = ['Parabel 10', 'Parabel 2', 'Parabel 2']

  it('counts correct rows', () => {
    const r = matchResult({ '0': 'Parabel 10', '1': 'Parabel 1', '2': 'Parabel 2' }, key)
    expect(r).toMatchObject({ correct: 2, total: 3, rows: [true, false, true] })
    expect(scoreFromRatio(r.ratio, 6)).toBe(4)
  })

  it('blank rows are null and score nothing', () => {
    const r = matchResult({ '1': 'Parabel 2' }, key)
    expect(r.rows).toEqual([null, true, null])
    expect(scoreFromRatio(r.ratio, 3)).toBe(1)
  })

  it('no answer / no rows → 0', () => {
    expect(matchResult(undefined, key).ratio).toBe(0)
    expect(matchResult({ '0': 'x' }, []).ratio).toBe(0)
  })

  it('full marks for all rows correct', () => {
    expect(matchResult({ '0': 'Parabel 10', '1': 'Parabel 2', '2': 'Parabel 2' }, key).ratio).toBe(1)
  })
})

describe('sanitizeMatchAnswer', () => {
  it('keeps numeric keys with string values, drops the rest', () => {
    expect(sanitizeMatchAnswer({ '0': 'A', '01': 'B', x: 'C', '2': 3 })).toEqual({ '0': 'A', '1': 'B' })
  })

  it('rejects non-objects', () => {
    expect(sanitizeMatchAnswer(null)).toBeNull()
    expect(sanitizeMatchAnswer(['A'])).toBeNull()
    expect(sanitizeMatchAnswer('A')).toBeNull()
  })

  it('drops oversized targets', () => {
    expect(sanitizeMatchAnswer({ '0': 'x'.repeat(501) })).toEqual({})
  })
})

describe('formatMatchAnswer / answeredRowCount', () => {
  it('lists rows in order with labels and blanks', () => {
    expect(formatMatchAnswer({ '1': 'B' }, ['a', 'b'])).toBe('1: a → (blank); 2: b → B')
    expect(formatMatchAnswer({ '0': 'A' })).toBe('1 → A')
    expect(answeredRowCount({ '0': 'A', '1': '' })).toBe(1)
  })
})

describe('parseGradableComponents with type="match"', () => {
  it('lists the question with its rows', () => {
    const content = `## Aufgabe 3\n<question id="zuordnen-c" type="match" points="6">${BODY}</question>\n\n<question id="q2" type="single">\n<answer correct="true">x</answer>\n</question>`
    const [match, single] = parseGradableComponents(content)
    expect(match).toMatchObject({
      componentId: 'quiz-zuordnen-c',
      kind: 'quiz',
      questionType: 'match',
      maxPoints: 6,
      label: 'Aufgabe 3',
    })
    expect(match.matchRows).toHaveLength(3)
    expect(single.componentId).toBe('quiz-q2')
    expect(single.matchRows).toBeUndefined()
  })
})
