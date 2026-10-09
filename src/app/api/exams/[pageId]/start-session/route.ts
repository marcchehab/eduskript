/**
 * Exam Session Start API Route
 *
 * This route handles creating an exam session after token validation.
 * It exists because Server Components cannot set cookies during render.
 *
 * Flow:
 * 1. The exam page sees a valid (not yet consumed) SEB one-time token
 * 2. It redirects here with that token, the site and a relative returnUrl
 * 3. This route CONSUMES the token (one-time), takes the user from the token
 *    row, creates the session, sets the cookie and redirects back
 *
 * Security (bughunt #40, #27): the user is never taken from the query
 * string — only from a valid unconsumed token bound to this page. The skript
 * comes from the page row. siteId is required and must place the page. The
 * returnUrl must be a same-origin path (no open redirect).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createExamSession, validateExamToken } from '@/lib/exam-tokens'
import { getPublicOrigin } from '@/lib/public-origin'
import { isItemPlacedOnSite } from '@/lib/site-access'
import { prisma } from '@/lib/prisma'

/** Only same-origin absolute paths: "/x", never "//host" or "/\\host". */
function isSafeReturnPath(p: string | null): p is string {
  return !!p && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params
  const searchParams = request.nextUrl.searchParams

  const token = searchParams.get('token')
  const returnUrl = searchParams.get('returnUrl')
  const siteId = searchParams.get('siteId')

  if (!token || !siteId || !isSafeReturnPath(returnUrl)) {
    return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 })
  }

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { skriptId: true } })
  if (!page) {
    return NextResponse.json({ error: 'Page not found' }, { status: 404 })
  }
  if (!(await isItemPlacedOnSite(pageId, siteId))) {
    return NextResponse.json({ error: 'Exam is not on this site' }, { status: 403 })
  }

  // One-time: consumes the token; null when unknown/expired/used/other page.
  const userId = await validateExamToken(token, pageId, true)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired exam token' }, { status: 401 })
  }

  const sessionId = await createExamSession(userId, pageId, page.skriptId, siteId)

  const cookieStore = await cookies()
  cookieStore.set('exam_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 4 * 60 * 60, // 4 hours
    path: '/',
  })

  // Redirect back to the exam page (without the seb_token since session is now active)
  const redirectUrl = new URL(returnUrl, getPublicOrigin(request))
  redirectUrl.searchParams.delete('seb_token')

  return NextResponse.redirect(redirectUrl)
}
