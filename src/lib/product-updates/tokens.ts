/**
 * Signed tokens for product-update links. HMAC-SHA256 with NEXTAUTH_SECRET
 * (rotating that secret invalidates every link already sent — unsubscribe
 * links in old mails included; the account-settings toggle still works).
 *
 * - unsubscribe / subscribe: `<userId>.<sig>`, no expiry. Possession of the
 *   link is the only authorization, which is what one-click (un)subscribe
 *   needs. Purpose-separated, so an unsubscribe token can't subscribe.
 * - approve: signature over draft id + expiresAt. Expiry and single use are
 *   enforced against the ProductUpdate row (service.ts), not by the token.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export type UserTokenPurpose = 'unsubscribe' | 'subscribe'

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set')
  return s
}

function hmac(message: string): string {
  return createHmac('sha256', secret()).update(message).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function signUserToken(purpose: UserTokenPurpose, userId: string): string {
  return `${userId}.${hmac(`product-updates:${purpose}:${userId}`)}`
}

/** The user id the token was issued for, or null if malformed/forged. */
export function verifyUserToken(purpose: UserTokenPurpose, token: string | null | undefined): string | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const userId = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  return safeEqual(sig, hmac(`product-updates:${purpose}:${userId}`)) ? userId : null
}

export function signApproveToken(draftId: string, expiresAt: Date): string {
  return hmac(`product-updates:approve:${draftId}:${expiresAt.getTime()}`)
}

export function verifyApproveToken(draftId: string, expiresAt: Date, token: string | null | undefined): boolean {
  if (!token) return false
  return safeEqual(token, signApproveToken(draftId, expiresAt))
}
