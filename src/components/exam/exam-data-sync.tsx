'use client'

/**
 * Exam Data Sync Component
 *
 * This component handles data synchronization for students in SEB exam mode.
 * It provides exam session context AND directly sets the sync engine user,
 * enabling data sync when NextAuth session isn't available.
 *
 * The problem: UserDataProvider uses useSession() from NextAuth, but in SEB
 * mode students are authenticated via exam_session cookie, not NextAuth — and
 * UserDataProvider is mounted ABOVE this component (root layout), so it can't
 * read the exam-session React context we provide below.
 *
 * The solution: This component:
 * 1. Wraps children with ExamSessionProvider (so other descendants like
 *    AnnotationLayer can read useExamSession()).
 * 2. Reports the exam user UP to UserDataProvider via context, so that single
 *    owner resolves the real userId, treats the student as authenticated, and
 *    drives syncEngine.setUser — instead of clobbering it with null (which
 *    silently disabled all live sync for SEB students).
 */

import { useEffect } from 'react'
import { ExamSessionProvider } from '@/contexts/exam-session-context'
import { useUserDataContext } from '@/lib/userdata/provider'
import { createLogger } from '@/lib/logger'

const log = createLogger('exam:data-sync')

interface ExamDataSyncProps {
  /** The authenticated user's ID from the exam session */
  userId: string
  /** Optional user name for display */
  userName?: string | null
  /** Optional user email for display */
  userEmail?: string | null
  /** The page ID this exam session is for */
  pageId: string
  /** Children to render */
  children: React.ReactNode
}

/**
 * Provides exam session authentication context and data sync for SEB mode
 *
 * Place this inside the component tree for exam pages where the user
 * is authenticated via exam_session cookie rather than NextAuth.
 *
 * This component:
 * - Provides ExamSessionContext so useSyncedUserData knows we're authenticated
 * - Sets the sync engine user directly for the initial sync
 */
export function ExamDataSync({ userId, userName, userEmail, pageId, children }: ExamDataSyncProps) {
  const { setExamSessionUser } = useUserDataContext()

  useEffect(() => {
    log('Reporting exam-session user to UserDataProvider', { userId: userId.substring(0, 8) + '...' })
    // Hand the exam user up to the root UserDataProvider, which owns
    // syncEngine.setUser + the isAuthenticated gate. Clear on unmount so a
    // later non-exam render doesn't keep syncing as this student.
    setExamSessionUser(userId)
    return () => setExamSessionUser(null)
  }, [userId, setExamSessionUser])

  return (
    <ExamSessionProvider
      isInExamSession={true}
      user={{ id: userId, name: userName, email: userEmail }}
      pageId={pageId}
    >
      {children}
    </ExamSessionProvider>
  )
}
