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

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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
  /** Teacher only: set (number) or clear (null = revert to auto) an override. */
  setOverride: (componentId: string, awardedPoints: number | null) => Promise<void>
}

const empty: ReviewState = { grade: null, totalEarned: null, totalMax: null, byComponent: {} }

const ExamReviewContext = createContext<ReviewContextValue>({
  ...empty,
  active: false,
  mode: 'review',
  loading: false,
  setOverride: async () => {},
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() flips a loading flag before its fetch; intentional
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

  const value = useMemo<ReviewContextValue>(
    () => ({ ...state, active, mode, loading, setOverride }),
    [state, active, mode, loading, setOverride],
  )

  return <ExamReviewContext.Provider value={value}>{children}</ExamReviewContext.Provider>
}

/** Per-component lookup. Returns null when inactive or no entry for this id. */
export function useComponentReview(componentId: string): {
  active: boolean
  mode: 'grade' | 'review'
  review: ComponentReview | null
  setOverride: (awardedPoints: number | null) => Promise<void>
} {
  const ctx = useContext(ExamReviewContext)
  return {
    active: ctx.active,
    mode: ctx.mode,
    review: ctx.active ? ctx.byComponent[componentId] ?? null : null,
    setOverride: (awardedPoints) => ctx.setOverride(componentId, awardedPoints),
  }
}

export function useExamReview() {
  return useContext(ExamReviewContext)
}
