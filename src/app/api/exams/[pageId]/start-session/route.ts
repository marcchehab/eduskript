/**
 * Exam Session Start API Route
 *
 * This route handles creating an exam session after token validation.
 * It exists because Server Components cannot set cookies during render.
 *
 * Flow:
 * 1. Page validates SEB token, determines session is needed
 * 2. Page redirects to this route with userId, skriptId, and returnUrl
 * 3. This route creates the session, sets the cookie, and redirects back
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createExamSession } from '@/lib/exam-tokens'
import { getPublicOrigin } from '@/lib/public-origin'
import { isItemPlacedOnSite } from '@/lib/site-access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params
  const searchParams = request.nextUrl.searchParams

  const userId = searchParams.get('userId')
  const skriptId = searchParams.get('skriptId')
  const returnUrl = searchParams.get('returnUrl')
  // Site scoping: the session is pinned to the site the exam route rendered.
  const siteId = searchParams.get('siteId') ?? ''

  if (!userId || !skriptId || !returnUrl) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    )
  }
  if (siteId && !(await isItemPlacedOnSite(pageId, siteId))) {
    return NextResponse.json({ error: 'Exam is not on this site' }, { status: 403 })
  }

  // Create the exam session
  const sessionId = await createExamSession(userId, pageId, skriptId, siteId)

  // Set the cookie
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
