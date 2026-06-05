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

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useTeacherClass } from '@/contexts/teacher-class-context'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { useStudentScopedFetch } from '@/hooks/use-student-scoped-fetch'

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

  // Identity-guarded fetch: `snapshots` is the CURRENT student's checkpoints or
  // null (loading / mismatch). Out-of-order responses for a previously-selected
  // student are discarded, so a slow earlier response can never overwrite the
  // current student's view. See useStudentScopedFetch.
  const { data: snapshots, isLoading, error } = useStudentScopedFetch<Record<string, StudentSnapshot>>(
    studentId,
    [pageId, refetchToken],
    (sid, signal) =>
      fetch(`/api/exams/${pageId}/student-snapshot?studentId=${encodeURIComponent(sid)}`, { signal, cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((j: { snapshots?: Record<string, StudentSnapshot> }) => j.snapshots ?? {}),
  )

  const value = useMemo<StudentSnapshotContextValue>(
    () => ({ isViewing, snapshots, isLoading, error }),
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
