import { describe, it, expect } from 'vitest'
import {
  extractCriterionRegex,
  stripInlineRegex,
  runCriterionCheck,
  sanitizeFlags,
} from '@/lib/scoring/regex-check'

describe('extractCriterionRegex', () => {
  it('pulls an inline regex out of a description', () => {
    expect(extractCriterionRegex('Verwendet .append() (using Regex: /\\.append\\s*\\(/)')).toEqual({
      pattern: '\\.append\\s*\\(',
    })
  })

  it('captures flags', () => {
    expect(extractCriterionRegex('x (Regex: /foo/i)')).toEqual({ pattern: 'foo', flags: 'i' })
  })

  it('allows escaped slashes inside the pattern', () => {
    expect(extractCriterionRegex('y (using Regex: /a\\/b/)')).toEqual({ pattern: 'a\\/b' })
  })

  it('returns null when there is no annotation', () => {
    expect(extractCriterionRegex('Filtert die richtige Variable')).toBeNull()
  })

  it('returns null for an invalid (uncompilable) pattern', () => {
    expect(extractCriterionRegex('z (using Regex: /(unbalanced/)')).toBeNull()
  })
})

describe('stripInlineRegex', () => {
  it('removes the annotation, leaving clean human prose', () => {
    expect(stripInlineRegex('Gibt eine Liste zurück (using Regex: /return\\s+\\S/)')).toBe(
      'Gibt eine Liste zurück',
    )
  })
  it('leaves a plain description untouched', () => {
    expect(stripInlineRegex('Filtert die richtige Variable')).toBe('Filtert die richtige Variable')
  })
})

describe('runCriterionCheck', () => {
  it('matches a for-header even when the surrounding code is broken', () => {
    const broken = 'def f(n):\n    x[i]\n    for i in range (1,n):\n            if n % 2 == 0:\n        x.append(i)'
    expect(runCriterionCheck('for\\s+\\w+\\s+in\\s+range\\s*\\(', undefined, broken).matched).toBe(true)
  })

  it('accepts a comprehension for a lenient return check', () => {
    expect(runCriterionCheck('return\\s+\\S', undefined, 'return [i for i in range(3)]').matched).toBe(true)
    expect(runCriterionCheck('return\\s+\\S', undefined, 'return ergebnis').matched).toBe(true)
  })

  it('reports an invalid pattern instead of throwing', () => {
    const r = runCriterionCheck('(unbalanced', undefined, 'x')
    expect(r.matched).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('rejects an over-long pattern', () => {
    expect(runCriterionCheck('a'.repeat(2000), undefined, 'aaaa').error).toBeTruthy()
  })
})

describe('sanitizeFlags', () => {
  it('drops the stateful g/y flags and defaults to m', () => {
    expect(sanitizeFlags('gimy')).toBe('im')
    expect(sanitizeFlags(undefined)).toBe('m')
    expect(sanitizeFlags('')).toBe('m')
  })
})
