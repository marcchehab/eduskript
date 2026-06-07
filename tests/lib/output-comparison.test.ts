import { describe, it, expect } from 'vitest'
import {
  normalizeOutput,
  levenshtein,
  similarityRatio,
  diffLines,
  compareOutput,
  scoreFromRatio,
} from '@/lib/output-comparison'

describe('output-comparison', () => {
  describe('normalizeOutput', () => {
    it('strips trailing whitespace per line and trailing newline', () => {
      expect(normalizeOutput('0  \n2\t\n4\n')).toBe('0\n2\n4')
    })
    it('normalizes CRLF and lone CR to LF', () => {
      expect(normalizeOutput('a\r\nb\rc')).toBe('a\nb\nc')
    })
    it('drops leading/trailing blank lines but keeps internal ones', () => {
      expect(normalizeOutput('\n\na\n\nb\n\n')).toBe('a\n\nb')
    })
    it('ignoreCase lowercases', () => {
      expect(normalizeOutput('Hello', { ignoreCase: true })).toBe('hello')
    })
    it('ignoreWhitespace collapses internal runs', () => {
      expect(normalizeOutput('a   b\tc', { ignoreWhitespace: true })).toBe('a b c')
    })
    it('treats commas as ordinary characters (no line splitting)', () => {
      expect(normalizeOutput('6,30')).toBe('6,30')
      expect(normalizeOutput('13, einer')).toBe('13, einer')
      expect(normalizeOutput('1,2,3')).toBe('1,2,3')
    })
    it('trims leading AND trailing whitespace per line', () => {
      expect(normalizeOutput(' 6\n30 ')).toBe('6\n30')
      expect(normalizeOutput('  hello  ')).toBe('hello')
    })
    it('handles null/undefined', () => {
      expect(normalizeOutput(null)).toBe('')
      expect(normalizeOutput(undefined)).toBe('')
    })
  })

  describe('levenshtein', () => {
    it('classic example', () => {
      expect(levenshtein('kitten', 'sitting')).toBe(3)
    })
    it('identical → 0', () => {
      expect(levenshtein('abc', 'abc')).toBe(0)
    })
    it('empty operands', () => {
      expect(levenshtein('', 'abc')).toBe(3)
      expect(levenshtein('abc', '')).toBe(3)
    })
  })

  describe('similarityRatio', () => {
    it('identical → 1', () => {
      expect(similarityRatio('0\n2\n4', '0\n2\n4')).toBe(1)
    })
    it('both empty → 1', () => {
      expect(similarityRatio('', '')).toBe(1)
    })
    it('one char off in a short string', () => {
      // "0\n2\n4" vs "0\n2\n5": 1 edit over length 5 → 0.8
      expect(similarityRatio('0\n2\n4', '0\n2\n5')).toBeCloseTo(0.8, 5)
    })
    it('completely different → low', () => {
      expect(similarityRatio('abcd', 'wxyz')).toBe(0)
    })
  })

  describe('diffLines', () => {
    it('marks equal, missing (expected) and extra (student) lines', () => {
      const rows = diffLines('0\n2\n4', '0\n5\n4')
      expect(rows).toEqual([
        { type: 'equal', value: '0' },
        { type: 'expected', value: '2' },
        { type: 'student', value: '5' },
        { type: 'equal', value: '4' },
      ])
    })
  })

  describe('compareOutput', () => {
    it('exact after normalization (trailing newline ignored)', () => {
      const r = compareOutput('0\n2\n4\n', '0\n2\n4')
      expect(r.exact).toBe(true)
      expect(r.ratio).toBe(1)
    })
    it('partial when one line differs', () => {
      const r = compareOutput('0\n5\n4', '0\n2\n4')
      expect(r.exact).toBe(false)
      expect(r.ratio).toBeCloseTo(2 / 3, 5) // 2 of 3 lines exact
    })
    it('scores 0 when every line is wrong, even with shared characters', () => {
      // Reported bug: char-level similarity gave 0.5 here. Both lines are wrong.
      expect(compareOutput('0\n1', '10\n5').ratio).toBe(0)
      expect(compareOutput('1', '30').ratio).toBe(0)
    })
    it('half credit for one of two lines right', () => {
      expect(compareOutput('10\n1', '10\n5').ratio).toBe(0.5)
    })
    it('extra wrong lines lower the ratio (penalize padding)', () => {
      // 2 expected lines, both produced, plus 2 bogus extra lines → 2/4.
      expect(compareOutput('10\n5\nx\ny', '10\n5').ratio).toBe(0.5)
    })
    it('respects ignoreCase', () => {
      expect(compareOutput('TRUE', 'true', { ignoreCase: true }).exact).toBe(true)
      expect(compareOutput('TRUE', 'true').exact).toBe(false)
    })
    it('a comma is literal, not a line separator', () => {
      expect(compareOutput('6,30', '6\n30').exact).toBe(false)
      expect(compareOutput('13, einer', '13 einer').exact).toBe(false)
    })
    it('per-line whitespace is ignored on both sides', () => {
      expect(compareOutput(' 6\n30 ', '6\n30').exact).toBe(true)
    })
  })

  describe('scoreFromRatio', () => {
    it('rounds to 0.1 points', () => {
      expect(scoreFromRatio(0.93, 2)).toBe(1.9) // 1.86 → 1.9
      expect(scoreFromRatio(1, 3)).toBe(3)
      expect(scoreFromRatio(0, 5)).toBe(0)
      expect(scoreFromRatio(0.8, 1)).toBe(0.8)
    })
    it('clamps ratio to [0,1]', () => {
      expect(scoreFromRatio(1.5, 2)).toBe(2)
      expect(scoreFromRatio(-0.5, 2)).toBe(0)
    })
  })
})
