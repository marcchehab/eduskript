'use client'

import { Lock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { SEBQuitButton } from './seb-quit-button'
import { useIsInSEB } from '@/hooks/use-is-in-seb'

interface ExamLockedPageProps {
  pageTitle: string
  teacherName: string
  isLoggedIn: boolean
  loginUrl: string
}

/**
 * Shown when a student tries to access an exam page that is not unlocked for them
 */
export function ExamLockedPage({
  pageTitle,
  teacherName,
  isLoggedIn,
  loginUrl
}: ExamLockedPageProps) {
  // Inside SEB the browser is locked to the exam domain, so "Go to Homepage"
  // dead-ends (or is blocked by the URL filter) — hide it there.
  const isInSEB = useIsInSEB()
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <Lock className="w-8 h-8 text-muted-foreground" />
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-2">Exam Locked</h1>

        <p className="text-muted-foreground mb-6">
          <span className="font-medium text-foreground">{pageTitle}</span> is an exam page
          that has not been unlocked for you yet.
        </p>

        {!isLoggedIn ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Please sign in to check if you have access to this exam.
            </p>
            <Button asChild>
              <Link href={loginUrl}>Sign In</Link>
            </Button>
            <div><SEBQuitButton /></div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your teacher ({teacherName}) has not yet unlocked this exam for your class.
              Please wait for your teacher to unlock it, or contact them if you believe
              this is an error.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => window.location.reload()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              {!isInSEB && (
                <Button variant="outline" asChild>
                  <Link href="/">Go to Homepage</Link>
                </Button>
              )}
              <SEBQuitButton />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
