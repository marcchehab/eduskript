'use client'

import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIsInSEB } from '@/hooks/use-is-in-seb'

/**
 * A "Quit Safe Exam Browser" button that only renders inside SEB.
 * Navigates to the quitURL which SEB recognizes and triggers its quit flow.
 */
export function SEBQuitButton() {
  const isInSEB = useIsInSEB()

  if (!isInSEB) return null

  return (
    <Button
      variant="destructive"
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- API route; needs a real request, not client routing
      onClick={() => { window.location.href = '/api/exams/end-session' }}
    >
      <LogOut className="w-4 h-4 mr-2" />
      Quit Safe Exam Browser
    </Button>
  )
}
