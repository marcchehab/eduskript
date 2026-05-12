'use client'

/**
 * Student Snapshot Context
 *
 * When a teacher selects a student on an exam page, every CodeEditor on
 * that page swaps from IndexedDB-loaded local state to a frozen view of
 * the student's most recent server-side checkpoint. To avoid N round-trips
 * (one per editor) we batch the fetch here: one GET per (pageId, studentId)
 * returns a map keyed by componentId, and each editor reads its own slice.
 *
 * Falls back to a no-op when no student is selected — non-exam pages and
 * teacher's own view see undefined and continue with their normal load path.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { createLogger } from '@/lib/logger'

const log = createLogger('student-snapshot')

export interface StudentSnapshot {
  componentId: string
  kind: string
  label: string | null
  createdAt: string
  payload: unknown
}

interface StudentSnapshotContextValue {
  /** True when a teacher is actively viewing a student's snapshot on this page. */
  isViewing: boolean
  /** Latest checkpoint per componentId, or null while loading / when not viewing. */
  snapshots: Record<string, StudentSnapshot> | null
  /** True while the fetch is in flight. */
  isLoading: boolean
  /** Last fetch error, if any. */
  error: string | null
}

const StudentSnapshotContext = createContext<StudentSnapshotContextValue>({
  isViewing: false,
  snapshots: null,
  isLoading: false,
  error: null,
})

interface ProviderProps {
  /** Database page id. */
  pageId: string
  /** When false, the provider is inert (no fetch, no viewing). Used to gate to exam pages + teacher viewers. */
  enabled?: boolean
  children: ReactNode
}

export function StudentSnapshotProvider({ pageId, enabled = true, children }: ProviderProps) {
  const { selectedStudent, isTeacher } = useTeacherClass()
  const studentId = enabled && isTeacher ? selectedStudent?.id ?? null : null
  const isViewing = studentId !== null

  const [snapshots, setSnapshots] = useState<Record<string, StudentSnapshot> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refetchToken, setRefetchToken] = useState(0)

  // Refetch when the viewed student progresses. Two channels:
  //   - exam-student-status: fires on hand-in (so a mid-view submission swaps
  //     the live snapshot for the frozen handin payload).
  //   - student-work-update: fires when the student saves any user-initiated
  //     checkpoint (Run / Check / manual). Auto-saves never reach the server.
  // Both arrive on `class:${classId}:teacher`; the SSE stream subscribes the
  // teacher to all their classes automatically.
  useRealtimeEvents(
    ['exam-student-status', 'student-work-update'],
    (event) => {
      if (event.pageId !== pageId) return
      if (event.studentId !== studentId) return
      setRefetchToken((n) => n + 1)
    },
    { enabled: isViewing }
  )

  useEffect(() => {
    if (!studentId) return

    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: fetch lifecycle markers (loading on, loading off in .finally).
    setIsLoading(true)

    fetch(`/api/exams/${pageId}/student-snapshot?studentId=${encodeURIComponent(studentId)}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`${res.status}`)
        }
        return res.json()
      })
      .then((data: { snapshots: Record<string, StudentSnapshot> }) => {
        if (cancelled) return
        setSnapshots(data.snapshots ?? {})
        setError(null)
        log('loaded', { count: Object.keys(data.snapshots ?? {}).length, studentId })
      })
      .catch((err) => {
        if (cancelled) return
        setSnapshots({})
        setError(String(err?.message ?? err))
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [pageId, studentId, refetchToken])

  // No "clear on exit" effect — consumers only read `snapshots` when
  // `isViewing` is true (gated by studentId), so stale entries sitting in
  // memory after the teacher exits view mode aren't observable. Skipping
  // the clear keeps this effect lint-clean (no synchronous setState in an
  // effect body) and avoids a wasted re-render every time view mode toggles.
  const value = useMemo<StudentSnapshotContextValue>(
    () => ({ isViewing, snapshots: isViewing ? snapshots : null, isLoading, error }),
    [isViewing, snapshots, isLoading, error]
  )

  return (
    <StudentSnapshotContext.Provider value={value}>
      {children}
    </StudentSnapshotContext.Provider>
  )
}

/**
 * Per-editor lookup. Returns the snapshot for this componentId when the
 * teacher is viewing a student's work, or null otherwise. `isViewing` lets
 * the caller distinguish "no snapshot yet, still loading" from "no snapshot
 * exists for this componentId" — both return a null snapshot.
 */
export function useStudentSnapshot(componentId: string): {
  isViewing: boolean
  isLoading: boolean
  snapshot: StudentSnapshot | null
} {
  const ctx = useContext(StudentSnapshotContext)
  const snapshot = ctx.snapshots?.[componentId] ?? null
  return {
    isViewing: ctx.isViewing,
    isLoading: ctx.isLoading,
    snapshot,
  }
}

export function useStudentSnapshotContext() {
  return useContext(StudentSnapshotContext)
}
