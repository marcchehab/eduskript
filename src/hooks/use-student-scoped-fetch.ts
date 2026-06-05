'use client'

/**
 * Load per-student data with an AIR-TIGHT identity guard: the returned `data` is
 * non-null ONLY when it was loaded for the studentId that is selected right now.
 * Stale, in-flight, or out-of-order responses are never surfaced — callers read
 * `data: null` (with `isLoading: true` during the switch gap) and render a
 * loading/empty state instead of another student's data.
 *
 * Guarantees:
 *  - Out-of-order safe: a monotonic request id discards any response that a newer
 *    request has superseded; each run also aborts the previous via AbortController.
 *  - Tagged: the stored result carries the studentId it was fetched for
 *    (captured client-side — these endpoints don't echo it).
 *  - Render-boundary guard: `data` is withheld unless `loadedStudentId === studentId`,
 *    so even a correctly-applied earlier result (stale the instant the selection
 *    advances) is never shown.
 *
 * Used by the teacher grade view's per-student contexts. The single source of
 * truth for "current student" is `useTeacherClass().selectedStudent.id`, threaded
 * in as `studentId`.
 */

import { useEffect, useRef, useState } from 'react'

interface ScopedState<T> {
  data: T | null
  /** The studentId `data` was loaded for (null = nothing loaded yet). */
  loadedStudentId: string | null
  error: string | null
}

export interface StudentScopedResult<T> {
  /** Non-null only when loaded for the CURRENT studentId; null otherwise. */
  data: T | null
  loadedStudentId: string | null
  /** True from the moment a (new) student is selected until that student's data lands. */
  isLoading: boolean
  error: string | null
}

export function useStudentScopedFetch<T>(
  studentId: string | null,
  /** Extra invalidation keys (e.g. pageId, a realtime refetch token). */
  deps: ReadonlyArray<unknown>,
  fetcher: (studentId: string, signal: AbortSignal) => Promise<T>,
): StudentScopedResult<T> {
  const [state, setState] = useState<ScopedState<T>>({ data: null, loadedStudentId: null, error: null })

  // Monotonic request id — a response is applied only if it's still the latest.
  const reqSeq = useRef(0)
  // Keep the fetcher fresh (callers pass inline closures) without re-subscribing.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (!studentId) {
      reqSeq.current++ // invalidate any in-flight load; the gate hides stale state
      return
    }
    const seq = ++reqSeq.current
    const sid = studentId
    const ctrl = new AbortController()
    fetcherRef.current(sid, ctrl.signal)
      .then((data) => {
        if (seq !== reqSeq.current) return // superseded by a newer request — discard
        setState({ data, loadedStudentId: sid, error: null })
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted || seq !== reqSeq.current) return
        setState({ data: null, loadedStudentId: sid, error: err instanceof Error ? err.message : String(err) })
      })
    return () => ctrl.abort()
    // deps are the caller's responsibility (studentId + their invalidation keys).
  }, [studentId, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  // The render-boundary guard: data only flows out when it's for the current student.
  const matches = studentId != null && state.loadedStudentId === studentId
  return {
    data: matches ? state.data : null,
    loadedStudentId: state.loadedStudentId,
    isLoading: studentId != null && !matches,
    error: matches ? state.error : null,
  }
}
