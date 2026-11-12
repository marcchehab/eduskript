/**
 * POST /api/auth/invite/opt-out   body: { token }
 *
 * "Don't send me invites" from the invite page: stores the recipient's
 * pseudonym in InviteOptOut (sendClassInvites skips it) and drops their open
 * invite links. POST only, so mail scanners pre-fetching the link can't
 * trigger it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { optOutViaInvite } from '@/lib/email-login'
import { getClientIdentifier, inviteCodeRateLimiter } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  if (!inviteCodeRateLimiter.check(getClientIdentifier(request)).allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }
  const { token } = await request.json().catch(() => ({}))
  if (typeof token !== 'string' || !(await optOutViaInvite(token))) {
    return NextResponse.json({ error: 'This invite link is invalid or has expired.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
