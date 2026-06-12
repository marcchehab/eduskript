'use client'

/**
 * Shared roster hook for the exam page.
 *
 * Both `ClassToolbar` (top) and `StudentNavigator` (gutter arrows)
 * need the same `{ students, counts }` data plus the live `examState`. They
 * used to each fetch independently; lifting the fetch here keeps them in
 * lockstep, halves the network footprint, and lets one realtime
 * subscription drive both.
 *
 * Polls every 10s as a safety net (matches the prior toolbar behavior) and
 * refetches immediately on `exam-student-status` SSE so a hand-in or reopen
 * shows up without waiting for the next poll tick.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import type { ExamLifecycleState } from '@/lib/exam-state'

export interface ExamRosterStudent {
  id: string
  name: string | null
  email: string | null
  studentPseudonym: string | null
  status: 'not_started' | 'taking' | 'submitted'
  /** How the submission was created (ExamSubmission.source): student | teacher | recovery. */
  source?: string
  startedAt?: string
  submittedAt?: string
  /** Throwaway emergency-laptop account → enables the "Transfer answers" action. */
  isTemporary?: boolean
  /** Per-student exam-state override; undefined when following the class state. */
  overrideState?: ExamLifecycleState
}

export interface ExamRosterCounts {
  total: number
  notStarted: number
  taking: number
  submitted: number
}

export type ExamState = ExamLifecycleState | null

interface UseExamRosterArgs {
  pageId: string
  /** When null the hook is dormant (no class picked yet). */
  classId: string | null
  /** Set false to skip polling when the consumer isn't on screen. */
  enabled?: boolean
}

interface UseExamRosterResult {
  students: ExamRosterStudent[]
  counts: ExamRosterCounts | null
  examState: ExamState
  isLoading: boolean
  refresh: () => void
}

const POLL_INTERVAL_MS = 10_000

export function useExamRoster({ pageId, classId, enabled = true }: UseExamRosterArgs): UseExamRosterResult {
  const [students, setStudents] = useState<ExamRosterStudent[]>([])
  const [counts, setCounts] = useState<ExamRosterCounts | null>(null)
  const [examState, setExamState] = useState<ExamState>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [refetchToken, setRefetchToken] = useState(0)

  const refresh = useCallback(() => setRefetchToken((n) => n + 1), [])

  useEffect(() => {
    if (!enabled || !classId) {
      setStudents([])
      setCounts(null)
      setExamState(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      try {
        const [stateRes, studentsRes] = await Promise.all([
          fetch(`/api/exams/${pageId}/state?classId=${classId}`, { cache: 'no-store' }),
          fetch(`/api/exams/${pageId}/students?classId=${classId}`, { cache: 'no-store' }),
        ])
        if (cancelled) return
        if (stateRes.ok) {
          const data = await stateRes.json()
          setExamState((data?.state as ExamState) ?? 'hidden')
        }
        if (studentsRes.ok) {
          const data = await studentsRes.json()
          if (!cancelled) {
            setStudents(data?.students ?? [])
            setCounts(data?.counts ?? null)
          }
        }
      } catch (err) {
        if (!cancelled) console.error('[useExamRoster] fetch failed', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [pageId, classId, enabled, refetchToken])

  // Real-time refresh on hand-in / reopen / state change so the UI doesn't
  // lag the next poll tick. All three events arrive on the teacher's class
  // channel that the SSE stream auto-subscribes to.
  useRealtimeEvents(
    ['exam-student-status', 'exam-state-change'],
    (event) => {
      if (event.pageId !== pageId) return
      if (classId && 'classId' in event && event.classId !== classId) return
      refresh()
    },
    { enabled: enabled && Boolean(classId) }
  )

  return { students, counts, examState, isLoading, refresh }
}
