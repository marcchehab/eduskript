/**
 * Exam Session End API Route
 *
 * This route handles ending an exam session and clearing the cookie.
 * It exists because Server Components cannot modify cookies during render.
 *
 * Flow:
 * 1. User clicks "Quit Exam" or navigates to quitURL
 * 2. Request comes here to clear the session
 * 3. Redirects to /exam-complete to show the completion message
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { deleteExamSession } from '@/lib/exam-tokens'
import { getPublicOrigin } from '@/lib/public-origin'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const examSessionId = cookieStore.get('exam_session')?.value

  if (examSessionId) {
    // Delete from database
    await deleteExamSession(examSessionId)

    // Clear the cookie
    cookieStore.delete('exam_session')
  }

  // Redirect to the completion page
  return NextResponse.redirect(new URL('/exam-complete', getPublicOrigin(request)))
}
