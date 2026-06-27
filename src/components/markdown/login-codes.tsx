'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { DEFAULT_POLL_INTERVAL_MS } from '@/lib/mail-hooks/constants'

// Live display of inbound login codes for a MailHook (e.g. shared Udemy
// account codes forwarded via CloudMailin). Polls GET /api/mail-hooks/<hook>/codes
// — requires a logged-in user (401 otherwise). Polling pauses while the tab is
// hidden (Page Visibility API) and stops after a stretch of empty polls so an
// idle/backgrounded page doesn't poll forever. Mirrors the old Informatikgarten
// <LoginCodes> UX; see src/app/api/mail-hooks/[token]/codes/route.ts.

interface ActiveCode {
  code: string
  expiresIn: number // seconds, as returned by the API
}

// Stop polling after this many consecutive empty responses (~minutes of idle).
const MAX_EMPTY_POLLS = 45

export function LoginCodes({
  hook,
  interval,
}: {
  hook?: string
  interval?: string
}) {
  const [codes, setCodes] = useState<ActiveCode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const emptyPollsRef = useRef(0)

  const pollMs = (() => {
    const n = Number(interval)
    return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_POLL_INTERVAL_MS
  })()

  useEffect(() => {
    if (!hook) {
      setError('No hook configured')
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) {
        schedule() // paused: re-check shortly, don't fetch
        return
      }
      try {
        const res = await fetch(`/api/mail-hooks/${encodeURIComponent(hook!)}/codes`)
        if (cancelled) return
        if (res.status === 401) {
          setError('Sign in to see login codes')
          return // stop polling; auth won't change without a reload
        }
        if (!res.ok) throw new Error('Could not load codes')
        const data = (await res.json()) as { codes: ActiveCode[] }
        setError(null)
        setCodes(data.codes)
        emptyPollsRef.current = data.codes.length > 0 ? 0 : emptyPollsRef.current + 1
        if (emptyPollsRef.current >= MAX_EMPTY_POLLS) {
          setStopped(true)
          return // give up until the user re-checks
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error')
      }
      schedule()
    }

    function schedule() {
      if (cancelled) return
      timer = setTimeout(poll, pollMs)
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [hook, pollMs, stopped])

  function recheck() {
    emptyPollsRef.current = 0
    setStopped(false)
  }

  return (
    <div className="my-4 rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        Active login codes
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {stopped
            ? 'Stopped checking.'
            : 'No active login codes right now. Trigger a login and the code will appear here.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {codes.map((c, i) => (
            <li
              key={`${c.code}-${i}`}
              className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
            >
              <span className="font-mono text-xl font-bold tracking-widest">
                {c.code}
              </span>
              <span className="text-xs text-muted-foreground">
                valid for {Math.max(0, Math.floor(c.expiresIn / 60))}m{' '}
                {Math.max(0, c.expiresIn % 60)}s
              </span>
            </li>
          ))}
        </ul>
      )}

      {stopped && (
        <button
          type="button"
          onClick={recheck}
          className="mt-3 text-xs text-primary underline"
        >
          Check again
        </button>
      )}
    </div>
  )
}
