import { describe, it, expect, beforeAll } from 'vitest'
import { createHash } from 'crypto'
import { createChallenge, verifySolution, leadingZeroBits } from '@/lib/script-import/pow'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ||= 'test-secret'
})

function solve(salt: string, difficulty: number) {
  for (let n = 0; ; n++) {
    if (leadingZeroBits(createHash('sha256').update(`${salt}:${n}`).digest()) >= difficulty) return String(n)
  }
}

describe('proof of work', () => {
  it('accepts a valid solution and rejects tampering/expiry', () => {
    const c = createChallenge()
    const nonce = solve(c.salt, c.difficulty)
    expect(verifySolution(c, nonce)).toBe(true)
    expect(verifySolution({ ...c, difficulty: 1 }, nonce)).toBe(false) // sig covers difficulty
    expect(verifySolution({ ...c, salt: 'ff' + c.salt.slice(2) }, nonce)).toBe(false)
    expect(verifySolution(c, nonce, c.expires + 1)).toBe(false)
  })

  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Buffer.from([0, 0x10]))).toBe(11)
    expect(leadingZeroBits(Buffer.from([0x80]))).toBe(0)
  })
})
