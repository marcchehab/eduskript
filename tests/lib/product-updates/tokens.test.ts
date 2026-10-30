import { describe, it, expect } from 'vitest'
import {
  signUserToken,
  verifyUserToken,
  signApproveToken,
  verifyApproveToken,
} from '@/lib/product-updates/tokens'

describe('product-update tokens', () => {
  it('round-trips a user token', () => {
    const token = signUserToken('unsubscribe', 'user123')
    expect(verifyUserToken('unsubscribe', token)).toBe('user123')
  })

  it('rejects a token for another purpose', () => {
    const token = signUserToken('unsubscribe', 'user123')
    expect(verifyUserToken('subscribe', token)).toBeNull()
  })

  it('rejects a tampered user id or signature', () => {
    const token = signUserToken('unsubscribe', 'user123')
    const sig = token.split('.')[1]
    expect(verifyUserToken('unsubscribe', `user124.${sig}`)).toBeNull()
    expect(verifyUserToken('unsubscribe', `user123.${sig.slice(0, -1)}x`)).toBeNull()
    expect(verifyUserToken('unsubscribe', 'user123')).toBeNull()
    expect(verifyUserToken('unsubscribe', '')).toBeNull()
    expect(verifyUserToken('unsubscribe', null)).toBeNull()
  })

  it('binds the approve token to id and expiry', () => {
    const expires = new Date('2026-11-01T10:00:00Z')
    const token = signApproveToken('draft1', expires)
    expect(verifyApproveToken('draft1', expires, token)).toBe(true)
    expect(verifyApproveToken('draft2', expires, token)).toBe(false)
    expect(verifyApproveToken('draft1', new Date(expires.getTime() + 1), token)).toBe(false)
    expect(verifyApproveToken('draft1', expires, '')).toBe(false)
  })

  it('depends on the server secret', () => {
    const token = signUserToken('unsubscribe', 'user123')
    const old = process.env.NEXTAUTH_SECRET
    process.env.NEXTAUTH_SECRET = 'another-secret'
    try {
      expect(verifyUserToken('unsubscribe', token)).toBeNull()
    } finally {
      process.env.NEXTAUTH_SECRET = old
    }
  })
})
