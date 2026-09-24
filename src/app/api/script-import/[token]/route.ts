import { NextResponse } from 'next/server'
import { getImportByToken, IMPORT_COOKIE } from '@/lib/script-import/service'

/** Status poll for the preview page. The token is the only credential. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const row = await getImportByToken(token)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(
    { status: row.status, error: row.error, claimed: Boolean(row.claimedAt) },
    { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } }
  )
}

/**
 * "Create account & take over": remember the token in an httpOnly cookie so
 * the dashboard can claim it after signup (see ../claim/route.ts).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const row = await getImportByToken(token)
  if (!row || row.status !== 'ready' || row.claimedAt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(IMPORT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(0, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)),
  })
  return res
}
