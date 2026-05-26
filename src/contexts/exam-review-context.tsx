'use client'

/**
 * Exam review context — drives the in-exam grade badges and answer hydration,
 * for two modes:
 *   - 'grade'  : a teacher viewing/grading one student. Components show the
 *                student's stored answer (from answerPayload) + an editable
 *                override badge.
 *   - 'review' : a student viewing their own returned exam. Their answers are
 *                already loaded by useSyncedUserData; the badge is read-only.
 *
 * Inert (active=false) until a studentId is provided, so it's cheap to mount on
 * every exam page. Mirrors the batched approach of [[student-snapshot-context]].
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { runChecksForStudents } from '@/lib/grading/run-checks.client'

export interface ComponentReview {
  componentId: string
  kind: 'quiz' | 'python'
  questionType: string | null
  label: string | null
  earned: number
  max: number
  autoEarned: number
  answered: boolean
  overridden: boolean
  answerPayload: unknown
}

interface ReviewState {
  grade: number | null
  totalEarned: number | null
  totalMax: number | null
  byComponent: Record<string, ComponentReview>
}

interface ReviewContextValue extends ReviewState {
  active: boolean
  mode: 'grade' | 'review'
  loading: boolean
  /** The exam page id (for components writing their own auto-grade). */
  pageId: string
  /** The student being reviewed (null = inert). */
  studentId: string | null
  /** Teacher only: re-running this student's python checks on this device. */
  runningChecks: boolean
  /** Teacher only: set (number) or clear (null = revert to auto) an override. */
  setOverride: (componentId: string, awardedPoints: number | null) => Promise<void>
  /** Teacher only: force a re-run of this student's python checks. */
  rerunChecks: () => Promise<void>
  /** Reload grades (debounced). Components call this after writing their own
   *  authoritative auto-grade (ExamCheckRun) so the totals/badges refresh. */
  refreshGrades: () => void
}

const empty: ReviewState = { grade: null, totalEarned: null, totalMax: null, byComponent: {} }

const ExamReviewContext = createContext<ReviewContextValue>({
  ...empty,
  active: false,
  mode: 'review',
  loading: false,
  pageId: '',
  studentId: null,
  runningChecks: false,
  setOverride: async () => {},
  rerunChecks: async () => {},
  refreshGrades: () => {},
})

interface ProviderProps {
  pageId: string
  mode: 'grade' | 'review'
  /** The student being reviewed. null = inert. */
  studentId: string | null
  children: ReactNode
}

export function ExamReviewProvider({ pageId, mode, studentId, children }: ProviderProps) {
  const active = !!studentId
  const [state, setState] = useState<ReviewState>(empty)
  const [loading, setLoading] = useState(false)
  const [runningChecks, setRunningChecks] = useState(false)
  // Which student's python checks we've already auto-run, so we don't loop
  // (run → reload → run …). Reset only on a manual re-run.
  const ranForRef = useRef<string | null>(null)

  const load = useCallback(() => {
    if (!studentId) {
      setState(empty)
      return
    }
    setLoading(true)
    fetch(`/api/exams/${pageId}/review?studentId=${encodeURIComponent(studentId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const byComponent: Record<string, ComponentReview> = {}
        for (const c of j.components as ComponentReview[]) byComponent[c.componentId] = c
        setState({ grade: j.grade, totalEarned: j.totalEarned, totalMax: j.totalMax, byComponent })
      })
      .catch(() => setState(empty))
      .finally(() => setLoading(false))
  }, [pageId, studentId])

  useEffect(() => {
    // No reset when studentId clears: consumers gate on `active`, so stale
    // state isn't observable (mirrors student-snapshot-context).
    if (!studentId) return
    load()
  }, [studentId, load])

  const setOverride = useCallback(
    async (componentId: string, awardedPoints: number | null) => {
      if (!studentId) return
      await fetch(`/api/exams/${pageId}/grading/question`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, componentId, awardedPoints }),
      }).catch(() => {})
      load() // refetch for fresh per-component + total + grade
    },
    [pageId, studentId, load],
  )

  // Teacher grade mode: re-run this student's python checks on this device
  // (authoritative), then refresh scores. Reuses the shared driver.
  const runChecks = useCallback(async () => {
    if (!studentId || mode !== 'grade') return
    setRunningChecks(true)
    try {
      await runChecksForStudents(pageId, [studentId])
      load()
    } finally {
      setRunningChecks(false)
    }
  }, [pageId, studentId, mode, load])

  const rerunChecks = useCallback(async () => {
    ranForRef.current = studentId // mark so the auto-effect doesn't double-fire
    await runChecks()
  }, [studentId, runChecks])

  // Debounced reload. Quiz components in grade mode each write their own
  // authoritative auto-grade (ExamCheckRun) then call this; the debounce
  // coalesces a page of them into a single /review refetch.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshGrades = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => load(), 400)
  }, [load])

  // Auto-run once per student when a grade-mode review has python components.
  useEffect(() => {
    if (mode !== 'grade' || !studentId) return
    if (ranForRef.current === studentId) return
    const hasPython = Object.values(state.byComponent).some((c) => c.kind === 'python')
    if (!hasPython) return
    ranForRef.current = studentId
    runChecks()
  }, [mode, studentId, state.byComponent, runChecks])

  const value = useMemo<ReviewContextValue>(
    () => ({ ...state, active, mode, loading, pageId, studentId, runningChecks, setOverride, rerunChecks, refreshGrades }),
    [state, active, mode, loading, pageId, studentId, runningChecks, setOverride, rerunChecks, refreshGrades],
  )

  return <ExamReviewContext.Provider value={value}>{children}</ExamReviewContext.Provider>
}

/** Per-component lookup. Returns null when inactive or no entry for this id. */
export function useComponentReview(componentId: string): {
  active: boolean
  mode: 'grade' | 'review'
  pageId: string
  studentId: string | null
  review: ComponentReview | null
  setOverride: (awardedPoints: number | null) => Promise<void>
  refreshGrades: () => void
} {
  const ctx = useContext(ExamReviewContext)
  return {
    active: ctx.active,
    mode: ctx.mode,
    pageId: ctx.pageId,
    studentId: ctx.studentId,
    review: ctx.active ? ctx.byComponent[componentId] ?? null : null,
    setOverride: (awardedPoints) => ctx.setOverride(componentId, awardedPoints),
    refreshGrades: ctx.refreshGrades,
  }
}

export function useExamReview() {
  return useContext(ExamReviewContext)
}
