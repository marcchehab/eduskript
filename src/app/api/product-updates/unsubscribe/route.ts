/**
 * POST /api/product-updates/unsubscribe?token=<signed>
 *
 * No login. Two callers: the button on /unsubscribe, and mail clients doing
 * RFC 8058 one-click unsubscribe (form body "List-Unsubscribe=One-Click"; the
 * body isn't needed, the token in the URL is the authorization). The token
 * is HMAC-signed per user, no expiry (src/lib/product-updates/tokens.ts).
 * Unknown/deleted users answer 200 too — there is nothing left to stop.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken } from '@/lib/product-updates/tokens'
import { setProductUpdates } from '@/lib/product-updates/service'

export async function POST(request: NextRequest) {
  const userId = verifyUserToken('unsubscribe', request.nextUrl.searchParams.get('token'))
  if (!userId) return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
  await setProductUpdates(userId, false)
  return NextResponse.json({ ok: true })
}
