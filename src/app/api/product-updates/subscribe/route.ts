/**
 * POST /api/product-updates/subscribe?token=<signed>
 *
 * One-click opt-in from the one-time consent mail (button on /subscribe).
 * No login; the per-user signed token is the authorization. POST only, so a
 * mail scanner fetching the link can't opt anybody in.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken } from '@/lib/product-updates/tokens'
import { setProductUpdates } from '@/lib/product-updates/service'

export async function POST(request: NextRequest) {
  const userId = verifyUserToken('subscribe', request.nextUrl.searchParams.get('token'))
  if (!userId) return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
  const ok = await setProductUpdates(userId, true)
  if (!ok) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
