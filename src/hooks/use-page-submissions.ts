'use client'

/**
 * Hook backing the unified teacher page-submissions toolbar.
 *
 * Polls `/api/pages/[id]/submissions` every 10s (same cadence as the exam
 * roster hook) and exposes a `refresh()` consumers call after a mutation
 * like delete. Returns one row per user that has any userData on the page,
 * including anonymous survey shell users.
 *
 * Unlike `useExamRoster`, this hook is not gated on a classId — it's the
 * across-the-board view of who actually submitted something.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PageSubmissionRow, PageSubmissionsResponse } from '@/app/api/pages/[id]/submissions/route'

export type { PageSubmissionRow }

interface UsePageSubmissionsArgs {
  pageId: string
  /** Set false to pause polling (e.g., toolbar collapsed off-screen). */
  enabled?: boolean
}

interface UsePageSubmissionsResult {
  /** False until the first response lands; after that, true only for page authors. */
  isAuthor: boolean
  /** True before the first response. Use to gate the initial "is the viewer an author?" render. */
  isResolving: boolean
  submissions: PageSubmissionRow[]
  /**
   * UserId of the survey shell user matching this browser's
   * `survey:${pageId}:sessionId` localStorage entry, when the viewer ever
   * answered the page anonymously. Lets the toolbar show "(you)" on that
   * row. Null when no match.
   */
  yourAnonymousUserId: string | null
  refresh: () => void
}

const POLL_INTERVAL_MS = 10_000

const SURVEY_SESSION_KEY = (pageId: string) => `survey:${pageId}:sessionId`

export function usePageSubmissions({
  pageId,
  enabled = true,
}: UsePageSubmissionsArgs): UsePageSubmissionsResult {
  const [isAuthor, setIsAuthor] = useState(false)
  const [isResolving, setIsResolving] = useState(true)
  const [submissions, setSubmissions] = useState<PageSubmissionRow[]>([])
  const [yourAnonymousUserId, setYourAnonymousUserId] = useState<string | null>(null)
  const [refetchToken, setRefetchToken] = useState(0)

  const refresh = useCallback(() => setRefetchToken(n => n + 1), [])

  useEffect(() => {
    if (!enabled) {
      setSubmissions([])
      setIsAuthor(false)
      setYourAnonymousUserId(null)
      setIsResolving(false)
      return
    }

    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    // Read once on mount: if this browser ever answered the survey on this
    // page anonymously, the sessionId is in localStorage and we pass it to
    // the server so the server can resolve it to a userId. The pseudonym
    // derivation needs the server HMAC secret, so the client can't do it.
    let sessionId: string | null = null
    try {
      sessionId = window.localStorage.getItem(SURVEY_SESSION_KEY(pageId))
    } catch { /* localStorage unavailable */ }

    const url = sessionId
      ? `/api/pages/${pageId}/submissions?sessionId=${encodeURIComponent(sessionId)}`
      : `/api/pages/${pageId}/submissions`

    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const data: PageSubmissionsResponse = await res.json()
          if (cancelled) return
          setIsAuthor(data.isAuthor)
          setSubmissions(data.submissions ?? [])
          setYourAnonymousUserId(data.yourAnonymousUserId ?? null)
          // Stop the heartbeat for non-authors — they'll never see the
          // toolbar, so polling wastes a request every 10s per public viewer.
          if (!data.isAuthor && interval) {
            clearInterval(interval)
            interval = null
          }
        }
      } catch (err) {
        if (!cancelled) console.error('[usePageSubmissions] fetch failed', err)
      } finally {
        if (!cancelled) setIsResolving(false)
      }
    }

    load()
    interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [pageId, enabled, refetchToken])

  return { isAuthor, isResolving, submissions, yourAnonymousUserId, refresh }
}
