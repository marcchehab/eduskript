/**
 * POST /api/product-updates/subscribe?token=<signed>
 *
 * Button on /subscribe. Two token kinds (tokens.ts):
 * - 'subscribe' (one-time consent mail to a teacher): sets the user's flag.
 * - 'guest-confirm' (double opt-in mail from the <newsletter /> block):
 *   confirms the guest subscription, see confirmGuest in service.ts.
 * No login; the signed token is the authorization. POST only, so a mail
 * scanner fetching the link can't opt anybody in.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken } from '@/lib/product-updates/tokens'
import { confirmGuest, setProductUpdates } from '@/lib/product-updates/service'

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  const userId = verifyUserToken('subscribe', token)
  if (userId) {
    const ok = await setProductUpdates(userId, true)
    if (!ok) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  const subscriberId = verifyUserToken('guest-confirm', token)
  if (subscriberId) {
    const ok = await confirmGuest(subscriberId)
    if (!ok) return NextResponse.json({ error: 'Link expired' }, { status: 410 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
}
