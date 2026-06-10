import { describe, it, expect } from 'vitest'
import { isSEBUserAgent, isSEBRequest } from '@/lib/seb'

describe('isSEBUserAgent', () => {
  it('matches SEB 3.x version string', () => {
    expect(isSEBUserAgent('Mozilla/5.0 (Windows NT 10.0) SEB/3.4.0')).toBe(true)
  })

  it('matches the SafeExamBrowser token', () => {
    expect(isSEBUserAgent('Mozilla/5.0 SafeExamBrowser/2.1')).toBe(true)
  })

  it('rejects a plain browser user agent', () => {
    expect(
      isSEBUserAgent('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36')
    ).toBe(false)
  })

  it('rejects an empty user agent', () => {
    expect(isSEBUserAgent('')).toBe(false)
  })
})

describe('isSEBRequest', () => {
  it('reads the user-agent header', () => {
    const seb = new Headers({ 'user-agent': 'Mozilla/5.0 SEB/3.4.0' })
    const plain = new Headers({ 'user-agent': 'Mozilla/5.0 Chrome/120' })
    expect(isSEBRequest(seb)).toBe(true)
    expect(isSEBRequest(plain)).toBe(false)
  })

  it('handles a missing user-agent header', () => {
    expect(isSEBRequest(new Headers())).toBe(false)
  })
})
