'use client'

import { Shield, ExternalLink, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LockdownRequiredPageProps {
  /** Same-site path the student was trying to reach; SEB reopens here. */
  from: string
}

/**
 * Shown (via middleware rewrite) when a logged-in student in a lockdown class
 * loads the teacher's site outside Safe Exam Browser. Anti-distraction, not
 * security — a logged-out/incognito visitor never sees this.
 */
export function LockdownRequiredPage({ from }: LockdownRequiredPageProps) {
  // sebs:// triggers SEB to launch and fetch the config, which opens `from`.
  const openInSEB = () => {
    const host = window.location.host
    window.location.href = `sebs://${host}/api/seb/site-config?from=${encodeURIComponent(from)}`
  }

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
          Your teacher has turned on lockdown mode for your class. To take part with
          your account, open this page in Safe Exam Browser.
        </p>

        <div className="mb-6">
          <Button size="lg" onClick={openInSEB}>
            <Play className="w-4 h-4 mr-2" />
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
          Not in this class? You can still browse normally without logging in. If
          you&apos;re having trouble, please contact your teacher.
        </p>
      </div>
    </div>
  )
}
