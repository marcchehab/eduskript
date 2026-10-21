import { describe, it, expect } from 'vitest'
import { feedbackText, marksBlockClosed, parseQuotedMarks } from '@/lib/ai/feedback-marks'

const ANSWER = `Good work on a).

\`\`\`marks
{"quote": "17 + 25 = 42", "kind": "correct", "text": "Right"}
{"quote": "8 · 7 = 54", "kind": "wrong", "text": "Check 8 · 7"}
\`\`\``

describe('feedbackText', () => {
  it('drops the marks block', () => {
    expect(feedbackText(ANSWER)).toBe('Good work on a).')
  })

  it('hides a partly received fence while streaming', () => {
    expect(feedbackText('Good.\n\n``')).toBe('Good.')
    expect(feedbackText('Good.\n\n```ma')).toBe('Good.')
  })

  it('keeps text after a block closed on the same line as the last mark', () => {
    const a = '```marks\n{"quote": "x", "kind": "wrong", "text": "t"}```\nThe text.'
    expect(feedbackText(a)).toBe('The text.')
    expect(parseQuotedMarks(a)).toHaveLength(1)
  })

  it('keeps text after a block that never closed, once the answer is final', () => {
    const a = '```marks\n{"quote": "x", "kind": "wrong", "text": "t"}\nThe text.'
    expect(feedbackText(a)).toBe('')
    expect(feedbackText(a, true)).toBe('The text.')
  })
})

describe('parseQuotedMarks', () => {
  it('parses complete lines and skips malformed ones', () => {
    const a = ANSWER.replace('```\n', '').replace(/\n```$/, '\n{"quote": "y", "kind": "nope"}\n{"quote": "z", "ki')
    expect(parseQuotedMarks(a).map((m) => m.quote)).toEqual(['17 + 25 = 42', '8 · 7 = 54'])
    expect(marksBlockClosed(a)).toBe(false)
    expect(marksBlockClosed(ANSWER)).toBe(true)
  })

  it('keeps only the last step of a quote joined across lines', () => {
    const a = '```marks\n{"quote": "3x + 5 = 20 → 3x = 15 → x = 3", "kind": "wrong", "text": "t"}\n```'
    expect(parseQuotedMarks(a)[0].quote).toBe('x = 3')
  })
})
