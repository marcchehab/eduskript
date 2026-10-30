/**
 * POST /api/product-updates/signup  { email, lang }
 *
 * Guest signup from the <newsletter /> block (visitors without an account).
 * Double opt-in: stores an unconfirmed ProductUpdateSubscriber and mails a
 * confirmation link (requestGuestSubscription in service.ts). Answers
 * { ok: true } for every well-formed address — new, pending, already
 * subscribed, over the per-address limit, or when the mail couldn't be sent
 * (logged) — so the response says nothing about which addresses exist.
 * 429 only for the per-IP limit (in-memory, per server instance).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requestGuestSubscription } from '@/lib/product-updates/service'
import {
  getClientIdentifier,
  productUpdateSignupAddressRateLimiter,
  productUpdateSignupIpRateLimiter,
} from '@/lib/rate-limit'
import { createLogger } from '@/lib/logger'

const log = createLogger('product-updates')

// Deliberately loose: the confirmation mail is the real check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  const ip = productUpdateSignupIpRateLimiter.check(getClientIdentifier(request))
  if (!ip.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(ip.retryAfter ?? 3600) } }
    )
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }
  const lang = body?.lang === 'de' ? 'de' : 'en'

  if (productUpdateSignupAddressRateLimiter.check(email).allowed) {
    try {
      await requestGuestSubscription(email, lang)
    } catch (error) {
      // No address in the log.
      log.error(`guest signup failed: ${(error as Error)?.message ?? String(error)}`)
    }
  }
  return NextResponse.json({ ok: true })
}
