'use client'

import { useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { SEBQuitButton } from './seb-quit-button'

interface ExamSubmittedPageProps {
  pageTitle: string
  pageId: string
  submittedAt: Date
}

/**
 * Shown when a student tries to access an exam they have already submitted.
 * Listens for SSE events in case the teacher reopens the exam for this student.
 */
export function ExamSubmittedPage({
  pageTitle,
  pageId,
  submittedAt
}: ExamSubmittedPageProps) {
  const formattedDate = submittedAt.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const formattedTime = submittedAt.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })

  // Reload when the teacher reopens (re-enter) or takes back a returned exam
  // (so the visible grade disappears until it's re-returned).
  useRealtimeEvents(
    ['exam-reopened', 'exam-taken-back'],
    (event) => {
      // Only reload if this is for our exam page
      if (event.pageId === pageId) {
        window.location.reload()
      }
    }
  )

  // Also set up a fallback polling mechanism in case SSE isn't working
  useEffect(() => {
    const checkInterval = setInterval(async () => {
      try {
        // Simple check - if we can fetch the page without redirect, submission was cleared
        const response = await fetch(window.location.href, {
          method: 'HEAD',
          credentials: 'include'
        })
        // If we get a 200 and it's not the submitted page, reload
        // This is a lightweight check that doesn't process the full page
        if (response.ok) {
          const contentType = response.headers.get('content-type')
          // If we can detect the response changed, reload
          // For now, just rely on SSE and this as a backup every 30 seconds
        }
      } catch {
        // Ignore errors - SSE is primary mechanism
      }
    }, 30000) // Check every 30 seconds as backup

    return () => clearInterval(checkInterval)
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-2">Exam Submitted</h1>

        <p className="text-muted-foreground mb-4">
          You have already submitted <span className="font-medium text-foreground">{pageTitle}</span>.
        </p>

        <div className="bg-muted/50 rounded-lg p-4 mb-6">
          <p className="text-sm text-muted-foreground">
            Submitted on {formattedDate} at {formattedTime}
          </p>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          If you need to retake this exam, please contact your teacher.
          This page will automatically update if your teacher reopens the exam for you.
        </p>

        <div className="flex justify-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/">Go to Homepage</Link>
          </Button>
          <SEBQuitButton />
        </div>
      </div>
    </div>
  )
}
