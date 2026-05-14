'use client'

import { Shield, ExternalLink, Play, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { SEBQuitButton } from './seb-quit-button'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'

interface SEBRequiredPageProps {
  pageTitle: string
  pageId: string // Page ID for generating config link
}

/**
 * Shown when an exam requires Safe Exam Browser but request is from a regular browser
 */
export function SEBRequiredPage({
  pageTitle,
  pageId
}: SEBRequiredPageProps) {
  const [isInSEB, setIsInSEB] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const dialog = useAlertDialog()

  useEffect(() => {
    // Check if we're already inside SEB (client-side check)
    const userAgent = navigator.userAgent
    setIsInSEB(userAgent.includes('SEB/') || userAgent.includes('SafeExamBrowser'))
  }, [])

  // Fetch a download link with auth token, then open SEB
  const handleOpenSEB = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/exams/${pageId}/download-link`)
      if (!response.ok) {
        throw new Error('Failed to generate download link')
      }
      const { url } = await response.json()
      // Navigate to the sebs:// URL which triggers SEB to open
      window.location.href = url
    } catch (error) {
      console.error('Error opening SEB:', error)
      dialog.showError('Failed to open Safe Exam Browser. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            {isInSEB ? (
              <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            ) : (
              <Shield className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            )}
          </div>
        </div>

        {isInSEB ? (
          <>
            <h1 className="text-2xl font-bold mb-2">Session Expired</h1>
            <p className="text-muted-foreground mb-6">
              Your exam session has expired or the authentication token was invalid.
              Please close SEB and start again from your regular browser.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              If this keeps happening, contact your teacher for assistance.
            </p>
            <SEBQuitButton />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-2">Safe Exam Browser Required</h1>

            <p className="text-muted-foreground mb-6">
              <span className="font-medium text-foreground">{pageTitle}</span> requires
              Safe Exam Browser (SEB) to ensure exam integrity.
            </p>

            <div className="mb-6">
              <Button size="lg" onClick={handleOpenSEB} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Open in Safe Exam Browser
              </Button>
            </div>

            <div className="space-y-4 text-left bg-muted/50 rounded-lg p-4 mb-6">
              <h2 className="font-semibold text-sm">Don&apos;t have SEB installed?</h2>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>
                  Download and install{' '}
                  <a
                    href="https://safeexambrowser.org/download_en.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Safe Exam Browser
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>Return to this page and click the button above</li>
              </ol>
            </div>

            <p className="text-xs text-muted-foreground">
              If you&apos;re having trouble, please contact your teacher for assistance.
            </p>
          </>
        )}
      </div>
    </div>
    <AlertDialogModal
      open={dialog.open} onOpenChange={dialog.setOpen}
      type={dialog.type} title={dialog.title} message={dialog.message}
      onConfirm={dialog.onConfirm} showCancel={dialog.showCancel}
      confirmText={dialog.confirmText} cancelText={dialog.cancelText}
      destructive={dialog.destructive}
    />
    </>
  )
}
