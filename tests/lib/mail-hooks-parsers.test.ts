import { describe, it, expect } from 'vitest'
import { extractCode, PARSERS } from '@/lib/mail-hooks/parsers'

describe('extractCode', () => {
  it('pulls a 6-digit code from an <h1> (IG-style HTML)', () => {
    const html = '<div><h1 style="color:#000">123456</h1></div>'
    expect(extractCode(html)).toBe('123456')
  })

  it('handles nested tags inside the <h1>', () => {
    const html = '<h1><strong>654321</strong></h1>'
    expect(extractCode(html)).toBe('654321')
  })

  it('falls back to plain text when there is no HTML', () => {
    expect(extractCode(undefined, 'Your code is 999000 — enjoy')).toBe('999000')
  })

  it('honors a valid regex override against the HTML body', () => {
    const html = '<p>code: 246810</p>'
    expect(extractCode(html, undefined, 'code:\\s*(\\d{6})')).toBe('246810')
  })

  it('ignores a malformed override and uses the default', () => {
    const html = '<h1>112233</h1>'
    expect(extractCode(html, undefined, '(')).toBe('112233')
  })

  it('returns null when nothing matches', () => {
    expect(extractCode('<p>no code here</p>', 'still nothing')).toBeNull()
  })
})

describe('login-code parser', () => {
  it('returns { code } on a match', () => {
    const result = PARSERS['login-code'](
      { html: '<h1>424242</h1>', from: 'noreply@udemy.com' },
      null
    )
    expect(result).toEqual({ code: '424242' })
  })

  it('returns null with no match', () => {
    const result = PARSERS['login-code'](
      { plain: 'hello', from: 'x@y.com' },
      null
    )
    expect(result).toBeNull()
  })

  it('reads the regex override from parserConfig', () => {
    const result = PARSERS['login-code'](
      { html: 'PIN=778899', from: 'x@y.com' },
      { regex: 'PIN=(\\d{6})' }
    )
    expect(result).toEqual({ code: '778899' })
  })
})
