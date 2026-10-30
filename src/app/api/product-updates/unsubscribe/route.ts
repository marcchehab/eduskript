/**
 * POST /api/product-updates/unsubscribe?token=<signed>
 *
 * No login. Two callers: the button on /unsubscribe, and mail clients doing
 * RFC 8058 one-click unsubscribe (form body "List-Unsubscribe=One-Click"; the
 * body isn't needed, the token in the URL is the authorization). The token
 * is HMAC-signed per user ('unsubscribe') or per guest subscriber
 * ('guest-unsubscribe', the row is deleted), no expiry
 * (src/lib/product-updates/tokens.ts). Unknown/deleted users and subscribers
 * answer 200 too — there is nothing left to stop.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken } from '@/lib/product-updates/tokens'
import { setProductUpdates, unsubscribeGuest } from '@/lib/product-updates/service'

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  const userId = verifyUserToken('unsubscribe', token)
  if (userId) {
    await setProductUpdates(userId, false)
    return NextResponse.json({ ok: true })
  }

  const subscriberId = verifyUserToken('guest-unsubscribe', token)
  if (subscriberId) {
    await unsubscribeGuest(subscriberId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
}
