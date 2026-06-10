'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { isSEBUserAgent } from '@/lib/seb'

/**
 * Invisible watcher mounted on every public tenant page (see [domain]/layout).
 * For logged-in students it opens an SSE connection and reloads the tab whenever
 * a teacher toggles lockdown on one of their classes — the reload re-hits the
 * middleware gate, which decides SEB-required vs. normal content.
 *
 * Renders nothing. Connects only for students, so anonymous/teacher traffic (and
 * ISR for crawlers) is untouched. The reload itself is the enforcement trigger;
 * this component does not block or overlay anything client-side.
 */
export function LockdownWatcher() {
  const { data: session, status } = useSession()
  const isStudent = session?.user?.accountType === 'student'

  useEffect(() => {
    if (status !== 'authenticated' || !isStudent) return

    const source = new EventSource('/api/lockdown/stream')
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        if (event?.type !== 'lockdown-change') return
        // Only non-SEB tabs need to react: locked → reload into the SEB-required
        // screen, unlocked → reload back to content. A tab already in SEB is
        // compliant, so leave it alone (don't disrupt an in-progress exam).
        if (!isSEBUserAgent(navigator.userAgent)) {
          window.location.reload()
        }
      } catch {
        /* ignore malformed frames */
      }
    }
    // On error EventSource auto-reconnects; nothing to do.
    return () => source.close()
  }, [status, isStudent])

  return null
}
