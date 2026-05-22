'use client'

/**
 * Fetches the append-only exam audit log for a given page+class and exposes
 * helpers to derive per-student totals (took 43m) and event timelines for
 * the teacher roster.
 *
 * Polls every 10s, in sync with `useExamRoster`. Refetches on the SSE
 * `exam-student-status` event so a hand-in or reopen reshapes the totals
 * immediately rather than on the next tick.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import type {
  ExamAuditEvent,
  ExamAuditResponse,
  ExamAuditRow,
} from '@/app/api/exams/[pageId]/audit/route'

export type { ExamAuditEvent, ExamAuditRow }

interface UseExamAuditArgs {
  pageId: string
  /** When null the hook is dormant. */
  classId: string | null
  enabled?: boolean
}

interface UseExamAuditResult {
  /** Events keyed by studentId, oldest-first. Empty when no audit rows yet. */
  events: Record<string, ExamAuditRow[]>
  refresh: () => void
}

const POLL_INTERVAL_MS = 10_000

export function useExamAudit({
  pageId,
  classId,
  enabled = true,
}: UseExamAuditArgs): UseExamAuditResult {
  const [events, setEvents] = useState<Record<string, ExamAuditRow[]>>({})
  const [refetchToken, setRefetchToken] = useState(0)

  const refresh = useCallback(() => setRefetchToken((n) => n + 1), [])

  useEffect(() => {
    if (!enabled || !classId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: drop stale events when the class is unselected.
      setEvents({})
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(
          `/api/exams/${pageId}/audit?classId=${encodeURIComponent(classId)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const data = (await res.json()) as ExamAuditResponse
        if (cancelled) return
        setEvents(data.events ?? {})
      } catch (err) {
        if (!cancelled) console.error('[useExamAudit] fetch failed', err)
      }
    }
    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [pageId, classId, enabled, refetchToken])

  useRealtimeEvents(
    ['exam-student-status', 'exam-state-change'],
    (event) => {
      if (event.pageId !== pageId) return
      if (classId && 'classId' in event && event.classId !== classId) return
      refresh()
    },
    { enabled: enabled && Boolean(classId) },
  )

  return { events, refresh }
}

interface AttemptSummary {
  /** Total milliseconds spent across all completed attempts. */
  completedMs: number
  /** Milliseconds elapsed in the current in-progress attempt (since the last
   *  `started` without a following `submitted`). Null when not in progress. */
  inProgressSinceMs: number | null
  /** Convenience: was there at least one `submitted` event? */
  hasSubmitted: boolean
}

/**
 * Walk a single student's event list and pair each `started` with the next
 * `submitted` to derive attempt durations. A trailing `started` with no
 * matching `submitted` is treated as in-progress.
 *
 * `now` is injected so callers can recompute the in-progress duration on a
 * timer without re-fetching the audit log. Defaults to Date.now().
 */
export function summariseAttempts(
  rows: ExamAuditRow[] | undefined,
  now: number = Date.now(),
): AttemptSummary {
  if (!rows || rows.length === 0) {
    return { completedMs: 0, inProgressSinceMs: null, hasSubmitted: false }
  }
  let completedMs = 0
  let inProgressSinceMs: number | null = null
  let openedAt: number | null = null
  let hasSubmitted = false

  for (const row of rows) {
    const ts = new Date(row.occurredAt).getTime()
    if (row.event === 'started') {
      // A new `started` while an earlier one is still open is unexpected
      // (reopen would normally fall between them) — count the gap anyway
      // so we never lose time.
      if (openedAt !== null) {
        completedMs += Math.max(0, ts - openedAt)
      }
      openedAt = ts
    } else if (row.event === 'submitted') {
      hasSubmitted = true
      if (openedAt !== null) {
        completedMs += Math.max(0, ts - openedAt)
        openedAt = null
      }
    } else if (row.event === 'reopened') {
      // Reopen with no open `started` is a no-op for duration. With an
      // open `started` it shouldn't happen (you can't reopen an in-flight
      // attempt) but we close the attempt defensively.
      if (openedAt !== null) {
        completedMs += Math.max(0, ts - openedAt)
        openedAt = null
      }
    }
  }

  if (openedAt !== null) {
    inProgressSinceMs = Math.max(0, now - openedAt)
  }

  return { completedMs, inProgressSinceMs, hasSubmitted }
}

/** Format a duration as a short string like "43m" or "1h 5m". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return '<1m'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Use this in components that want the per-student summary memoised. */
export function useStudentAttemptSummaries(
  events: Record<string, ExamAuditRow[]>,
  /** Tick value to drive the in-progress counter — pass a value that
   *  changes every ~30s if you want a live "Nm so far" label. */
  nowMs: number,
): Record<string, AttemptSummary> {
  return useMemo(() => {
    const out: Record<string, AttemptSummary> = {}
    for (const [studentId, rows] of Object.entries(events)) {
      out[studentId] = summariseAttempts(rows, nowMs)
    }
    return out
  }, [events, nowMs])
}
