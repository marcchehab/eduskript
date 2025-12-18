'use client'

import { Shield, ExternalLink, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  // Generate SEB config link - this URL serves the .seb config file with kiosk settings
  // SEB will download the config and apply settings including Assessment Mode (kiosk)
  const sebConfigLink = typeof window !== 'undefined'
    ? `sebs://${window.location.host}/api/exams/${pageId}/seb-config`
    : undefined

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Shield className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-2">Safe Exam Browser Required</h1>

        <p className="text-muted-foreground mb-6">
          <span className="font-medium text-foreground">{pageTitle}</span> requires
          Safe Exam Browser (SEB) to ensure exam integrity.
        </p>

        {sebConfigLink && (
          <div className="mb-6">
            <Button size="lg" asChild>
              <a href={sebConfigLink}>
                <Play className="w-4 h-4 mr-2" />
                Open in Safe Exam Browser
              </a>
            </Button>
          </div>
        )}

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
      </div>
    </div>
  )
}
