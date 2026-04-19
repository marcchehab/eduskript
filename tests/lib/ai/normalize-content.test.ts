import { describe, it, expect } from 'vitest'
import { normalizeContent } from '@/lib/ai/normalize-content'

describe('normalizeContent', () => {
  it('returns empty string for empty/null-ish input without adding a newline', () => {
    expect(normalizeContent('')).toBe('')
  })

  it('strips a leading BOM', () => {
    expect(normalizeContent('\uFEFFhello\n')).toBe('hello\n')
  })

  it('converts CRLF and bare CR to LF', () => {
    expect(normalizeContent('a\r\nb\rc\n')).toBe('a\nb\nc\n')
  })

  it('strips trailing whitespace from each line', () => {
    expect(normalizeContent('one   \ntwo\t\nthree\n')).toBe('one\ntwo\nthree\n')
  })

  it('collapses multiple trailing newlines into one', () => {
    expect(normalizeContent('a\n\n\n\n')).toBe('a\n')
  })

  it('adds a single trailing newline if missing', () => {
    expect(normalizeContent('hello')).toBe('hello\n')
  })

  it('NFC-normalizes decomposed accents', () => {
    // "é" decomposed: e + combining acute (U+0065 U+0301)
    const decomposed = 'caf\u0065\u0301'
    // "é" precomposed: U+00E9
    const precomposed = 'caf\u00E9'
    expect(normalizeContent(decomposed)).toBe(precomposed + '\n')
  })

  it('is idempotent — running twice gives the same result as once', () => {
    const input = 'a\r\nb  \n\n\n'
    const once = normalizeContent(input)
    expect(normalizeContent(once)).toBe(once)
  })

  it('preserves blank lines inside the content', () => {
    expect(normalizeContent('one\n\ntwo\n')).toBe('one\n\ntwo\n')
  })
})
