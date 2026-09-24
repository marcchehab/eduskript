/**
 * POST /api/script-import/claim — move an anonymous import into the signed-in
 * teacher's account. Token comes from the body or, after signup, from the
 * IMPORT_COOKIE set by the preview page's "Create account" button (signup
 * doesn't carry a callbackUrl through email verification / OAuth profile
 * completion, so the cookie is what survives the detour). Clears the cookie.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { claimImport, ClaimError, getImportByToken, IMPORT_COOKIE } from '@/lib/script-import/service'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const token = (typeof body.token === 'string' && body.token) || request.cookies.get(IMPORT_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'No import to take over' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { accountType: true } })
  const clear = (res: NextResponse) => {
    res.cookies.delete(IMPORT_COOKIE)
    return res
  }
  if (user?.accountType !== 'teacher') {
    return clear(NextResponse.json({ error: 'Only teacher accounts can take over a skript' }, { status: 403 }))
  }

  try {
    const result = await claimImport(token, session.user.id)
    return clear(NextResponse.json(result))
  } catch (err) {
    if (err instanceof ClaimError) {
      return clear(NextResponse.json({ error: err.message }, { status: err.status }))
    }
    console.error('[script-import] claim failed:', err)
    // Keep the cookie: a transient failure (S3, DB) can be retried on next dashboard load.
    return NextResponse.json({ error: 'Taking over the skript failed. Please try again.' }, { status: 500 })
  }
}

/**
 * Pending import for this browser (IMPORT_COOKIE), for the signup page's
 * "your skript is waiting" banner. No session needed: the cookie holds the
 * same token that already grants access to the preview.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(IMPORT_COOKIE)?.value
  const row = token ? await getImportByToken(token) : null
  if (!row || row.status !== 'ready' || row.claimedAt) return NextResponse.json({ pending: null })
  return NextResponse.json({ pending: { title: row.title ?? row.fileName, pages: row.pages.length } })
}
