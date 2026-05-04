/**
 * Hand In Button Component
 *
 * Button that allows students to submit their exam and exit SEB.
 * Includes a confirmation dialog to prevent accidental submissions.
 *
 * Flow:
 * 1. Student clicks "Hand in & Quit"
 * 2. Confirmation dialog appears
 * 3. On confirm: POST to /api/exams/[pageId]/hand-in
 * 4. Navigate to /api/exams/end-session (clears cookie, redirects to /exam-complete)
 */

'use client'

import { useState } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { userDataService } from '@/lib/userdata'

/**
 * Gather snapshots of every on-page code editor's IndexedDB state. The
 * hand-in route stores these atomically with the ExamSubmission as
 * `kind='handin'` checkpoints — that's the only durable copy of the
 * student's actual code, since the editor's main data is otherwise just
 * the live-synced userData record (which gets overwritten by future edits).
 */
async function gatherEditorSnapshots(pageId: string): Promise<Array<{ componentId: string; payload: unknown }>> {
  try {
    await userDataService.flush()
    const componentIds = await userDataService.getComponentsForPage(pageId)
    const editorIds = componentIds.filter((c) => c.startsWith('code-editor-'))
    const snapshots: Array<{ componentId: string; payload: unknown }> = []
    for (const componentId of editorIds) {
      const record = await userDataService.get(pageId, componentId)
      if (record) snapshots.push({ componentId, payload: record.data })
    }
    return snapshots
  } catch (error) {
    console.error('[HandInButton] failed to gather snapshots:', error)
    return []
  }
}

interface HandInButtonProps {
  pageId: string
}

export function HandInButton({ pageId }: HandInButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleHandIn = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      // Gather every code editor's current state from IndexedDB and POST
      // alongside the submission. The server stores these as 'handin'
      // checkpoints atomically with the ExamSubmission record.
      const snapshots = await gatherEditorSnapshots(pageId)

      const response = await fetch(`/api/exams/${pageId}/hand-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to submit exam')
      }

      // Navigate to end-session which clears cookie and redirects
      // SEB will then navigate to quitURL, ending the session
      window.location.href = '/api/exams/end-session'
    } catch (err) {
      console.error('Error handing in exam:', err)
      setError(err instanceof Error ? err.message : 'Failed to submit exam')
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        className="gap-2"
        disabled={isSubmitting}
        onClick={() => setIsOpen(true)}
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <LogOut className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">Hand in & Quit</span>
        <span className="sm:hidden">Quit</span>
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hand in your exam?</DialogTitle>
            <DialogDescription className="space-y-2">
              <p>
                Are you sure you want to hand in your exam and quit?
              </p>
              <p className="font-medium text-destructive">
                You will not be able to return after submitting.
              </p>
              {error && (
                <p className="text-destructive text-sm mt-2">
                  Error: {error}
                </p>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleHandIn}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Yes, hand in and quit'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
