/**
 * POST /api/auth/email-code/request   body: { email }
 *
 * Mails a 6-digit login code (src/lib/email-login.ts). Works for any address
 * (sign-up and sign-in use the same form). Answers identically whether or not
 * an account exists, so it can't be used to probe addresses. The address is
 * never stored or logged — only HMAC(email) reaches the DB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { normalizeEmail, requestLoginCode } from '@/lib/email-login'
import { generatePseudonym } from '@/lib/privacy/pseudonym'
import {
  emailCodeAddressRateLimiter,
  emailCodeGlobalRateLimiter,
  emailCodeIpRateLimiter,
  getClientIdentifier,
} from '@/lib/rate-limit'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:email-code')

function tooMany(retryAfter?: number) {
  return NextResponse.json(
    { error: 'Too many requests. Please wait a few minutes and try again.', retryAfter },
    { status: 429 }
  )
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = normalizeEmail((body as { email?: unknown }).email)
  if (!email) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const ip = emailCodeIpRateLimiter.check(getClientIdentifier(request))
  if (!ip.allowed) return tooMany(ip.retryAfter)
  const address = emailCodeAddressRateLimiter.check(generatePseudonym(email))
  if (!address.allowed) return tooMany(address.retryAfter)
  const global = emailCodeGlobalRateLimiter.check('all')
  if (!global.allowed) {
    log.error('Daily email-code limit reached')
    return NextResponse.json(
      { error: 'Email login is temporarily unavailable. Please try again later or use another sign-in method.' },
      { status: 503 }
    )
  }

  try {
    await requestLoginCode(email)
  } catch (error) {
    // sendEmail strips addresses from its own error text; log the class only.
    log.error(`Login code could not be sent: ${(error as Error).message}`)
    return NextResponse.json(
      { error: 'The code could not be sent. Please try again later.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true })
}
