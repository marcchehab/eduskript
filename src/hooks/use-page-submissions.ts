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
  refresh: () => void
}

const POLL_INTERVAL_MS = 10_000

export function usePageSubmissions({
  pageId,
  enabled = true,
}: UsePageSubmissionsArgs): UsePageSubmissionsResult {
  const [isAuthor, setIsAuthor] = useState(false)
  const [isResolving, setIsResolving] = useState(true)
  const [submissions, setSubmissions] = useState<PageSubmissionRow[]>([])
  const [refetchToken, setRefetchToken] = useState(0)

  const refresh = useCallback(() => setRefetchToken(n => n + 1), [])

  useEffect(() => {
    if (!enabled) {
      setSubmissions([])
      setIsAuthor(false)
      setIsResolving(false)
      return
    }

    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const res = await fetch(`/api/pages/${pageId}/submissions`, { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const data: PageSubmissionsResponse = await res.json()
          if (cancelled) return
          setIsAuthor(data.isAuthor)
          setSubmissions(data.submissions ?? [])
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

  return { isAuthor, isResolving, submissions, refresh }
}
