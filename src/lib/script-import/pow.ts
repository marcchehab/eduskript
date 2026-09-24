/**
 * Proof-of-work challenge for the anonymous upload (captcha replacement).
 *
 * No third-party captcha (privacy, no extra sub-processor). The server hands
 * out an HMAC-signed salt; the browser searches a nonce so that
 * sha256(salt + ":" + nonce) starts with DIFFICULTY zero bits (~2^17 hashes,
 * ~1–3 s with WebCrypto, computed while the user picks a file). The salt is
 * stored as ScriptImport.powSalt (unique), so each solution works once.
 *
 * This raises the cost of scripted mass uploads; it does not stop a
 * determined attacker. The per-IP and global daily limits (limits.ts) are the
 * actual cost cap. Client solver: src/app/(app)/import/import-upload.tsx.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

export const POW_DIFFICULTY = 17
const TTL_MS = 30 * 60 * 1000

export interface PowChallenge {
  salt: string
  expires: number
  difficulty: number
  sig: string
}

function secret() {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set')
  return s
}

const sign = (salt: string, expires: number, difficulty: number) =>
  createHmac('sha256', secret()).update(`script-import-pow:${salt}:${expires}:${difficulty}`).digest('hex')

export function createChallenge(now = Date.now()): PowChallenge {
  const salt = randomBytes(16).toString('hex')
  const expires = now + TTL_MS
  return { salt, expires, difficulty: POW_DIFFICULTY, sig: sign(salt, expires, POW_DIFFICULTY) }
}

export function leadingZeroBits(hash: Buffer): number {
  let bits = 0
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

/** Checks signature, expiry and work. Single use is enforced by the DB. */
export function verifySolution(c: PowChallenge, nonce: string, now = Date.now()): boolean {
  if (!c?.salt || typeof nonce !== 'string' || nonce.length > 32) return false
  if (c.difficulty < POW_DIFFICULTY || now > c.expires) return false
  const expected = Buffer.from(sign(c.salt, c.expires, c.difficulty), 'hex')
  const given = Buffer.from(String(c.sig), 'hex')
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  const hash = createHash('sha256').update(`${c.salt}:${nonce}`).digest()
  return leadingZeroBits(hash) >= c.difficulty
}
