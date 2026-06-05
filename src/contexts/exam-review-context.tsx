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
import { runChecksForStudents } from '@/lib/scoring/run-checks.client'

export interface ComponentReview {
  componentId: string
  kind: 'quiz' | 'python'
  questionType: string | null
  label: string | null
  earned: number
  max: number
  autoEarned: number
  /** The ai-source points, if an AI score exists (null otherwise). */
  aiEarned: number | null
  /** Which source won the effective points: 'check' | 'ai' | 'override' | null. */
  effectiveSource: string | null
  answered: boolean
  overridden: boolean
  /** Effective per-question feedback (AI rationale or teacher note; shown to the
   *  student on return). */
  feedback: string | null
  /** Raw per-source score rows (check / ai / override) for this component, so the
   *  grading UI can show each source's points + feedback + provenance. */
  sources: ComponentScoreSource[]
  /** The scoring rubric for this exercise (per page, all students), if any. Lets
   *  the grade UI edit it in place and detect AI scores made against an older one. */
  rubric: ComponentRubric | null
  answerPayload: unknown
}

export interface ComponentRubric {
  criteria: { id: string; description: string; points: number }[]
  maxPoints: number | null
  source: string // 'ai' | 'teacher'
  model: string | null
  /** When the rubric was last saved (ISO). Compared to an AI score's
   *  meta.rubricUpdatedAt to flag a stale score. */
  updatedAt: string
}

export interface ComponentScoreSource {
  source: string // 'check' | 'ai' | 'override'
  earned: number | null
  max: number | null
  feedback: string | null
  /** check: { passed, total }; ai: { model, rubricId, criteria: [...] }. */
  meta: unknown
}

interface ReviewState {
  grade: number | null
  totalEarned: number | null
  totalMax: number | null
  byComponent: Record<string, ComponentReview>
  /** The studentId this state was loaded for. Lets consumers (the quiz
   *  auto-grade recompute) confirm `byComponent`/answerPayload belongs to the
   *  currently-selected student before acting — `studentId` changes the instant
   *  a teacher switches students, but `byComponent` only catches up after the
   *  async /review reload, and acting in that window cross-wires one student's
   *  answers onto another's grade. */
  loadedStudentId: string | null
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
  /** Teacher only: set/clear per-question feedback (null/'' clears it). */
  setFeedback: (componentId: string, feedback: string | null) => Promise<void>
  /** Teacher only: clear the manual override (points AND feedback) in ONE request,
   *  so the row is deleted atomically — avoids the read-merge race of firing
   *  setOverride(null) + setFeedback(null) concurrently. */
  clearOverride: (componentId: string) => Promise<void>
  /** Teacher only: clear this student's AI score for a component (reverts the
   *  effective score to the check/override below it). */
  clearAiScore: (componentId: string) => Promise<void>
  /** Teacher only: force a re-run of this student's python checks. */
  rerunChecks: () => Promise<void>
  /** Reload grades (debounced). Components call this after writing their own
   *  authoritative check score (ComponentScore source="check") so the totals/badges refresh. */
  refreshGrades: () => void
}

const empty: ReviewState = { grade: null, totalEarned: null, totalMax: null, byComponent: {}, loadedStudentId: null }

const ExamReviewContext = createContext<ReviewContextValue>({
  ...empty,
  active: false,
  mode: 'review',
  loading: false,
  pageId: '',
  studentId: null,
  runningChecks: false,
  setOverride: async () => {},
  setFeedback: async () => {},
  clearOverride: async () => {},
  clearAiScore: async () => {},
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

  // Monotonic request id. A single action (score, switch, realtime) can fire
  // several overlapping load()s; under real network latency they can resolve
  // OUT OF ORDER, so a slower response for the PREVIOUS student would otherwise
  // overwrite the current one (the panel appears to "switch" to another student
  // ~1s later). We apply only the most-recent request's result.
  const reqSeq = useRef(0)
  // The student selected RIGHT NOW. A deferred load() — the debounced
  // refreshGrades, the reload after setOverride/setFeedback, or a retry — carries
  // a closure pointing at the student that was selected when it was scheduled.
  // If the teacher switched in the meantime, that stale load must NOT run:
  // loading the previous student here would store their loadedStudentId and bump
  // seq, discarding the current student's load and leaving the panel stuck blank.
  const currentSidRef = useRef<string | null>(studentId)

  const load = useCallback((attempt = 0) => {
    if (!studentId) {
      reqSeq.current++ // invalidate any in-flight load
      setState(empty)
      return
    }
    // Drop a stale deferred load whose student is no longer selected.
    if (studentId !== currentSidRef.current) return
    const seq = ++reqSeq.current
    const sid = studentId
    setLoading(true)
    fetch(`/api/exams/${pageId}/review?studentId=${encodeURIComponent(sid)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (seq !== reqSeq.current) return // superseded by a newer load — discard
        if (j.studentId && j.studentId !== sid) return // response for a different student
        const byComponent: Record<string, ComponentReview> = {}
        for (const c of j.components as ComponentReview[]) byComponent[c.componentId] = c
        setState({ grade: j.grade, totalEarned: j.totalEarned, totalMax: j.totalMax, byComponent, loadedStudentId: sid })
        setLoading(false)
      })
      .catch(() => {
        if (seq !== reqSeq.current || sid !== currentSidRef.current) return // superseded/switched
        // Transient failure for the current student: retry (bounded) so the
        // panel self-heals instead of stranding on the loading skeleton.
        if (attempt < 3) {
          setTimeout(() => {
            if (sid === currentSidRef.current && seq === reqSeq.current) load(attempt + 1)
          }, 500 * (attempt + 1))
        } else {
          setState(empty)
          setLoading(false)
        }
      })
  }, [pageId, studentId])

  useEffect(() => {
    // Mark the current student BEFORE loading so a concurrently-firing stale
    // deferred load (from the previous student) is dropped by the guard above.
    if (!studentId) { currentSidRef.current = null; return }
    currentSidRef.current = studentId
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

  const setFeedback = useCallback(
    async (componentId: string, feedback: string | null) => {
      if (!studentId) return
      await fetch(`/api/exams/${pageId}/grading/question`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Send only `feedback` so the points override is left untouched.
        body: JSON.stringify({ studentId, componentId, feedback }),
      }).catch(() => {})
      load()
    },
    [pageId, studentId, load],
  )

  const clearOverride = useCallback(
    async (componentId: string) => {
      if (!studentId) return
      // One request that nulls both fields → the route deletes the row.
      await fetch(`/api/exams/${pageId}/grading/question`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, componentId, awardedPoints: null, feedback: null }),
      }).catch(() => {})
      load()
    },
    [pageId, studentId, load],
  )

  const clearAiScore = useCallback(
    async (componentId: string) => {
      if (!studentId) return
      await fetch(
        `/api/exams/${pageId}/scoring/ai?studentId=${encodeURIComponent(studentId)}&componentId=${encodeURIComponent(componentId)}`,
        { method: 'DELETE' },
      ).catch(() => {})
      load()
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
  // authoritative check score (ComponentScore source="check") then call this; the
  // debounce coalesces a page of them into a single /review refetch.
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
    () => ({ ...state, active, mode, loading, pageId, studentId, runningChecks, setOverride, setFeedback, clearOverride, clearAiScore, rerunChecks, refreshGrades }),
    [state, active, mode, loading, pageId, studentId, runningChecks, setOverride, setFeedback, clearOverride, clearAiScore, rerunChecks, refreshGrades],
  )

  return <ExamReviewContext.Provider value={value}>{children}</ExamReviewContext.Provider>
}

/** Per-component lookup. Returns null when inactive or no entry for this id. */
export function useComponentReview(componentId: string): {
  active: boolean
  mode: 'grade' | 'review'
  pageId: string
  studentId: string | null
  /** studentId the current review data was loaded for; compare to studentId
   *  before acting on answerPayload (see ReviewState.loadedStudentId). */
  loadedStudentId: string | null
  review: ComponentReview | null
  setOverride: (awardedPoints: number | null) => Promise<void>
  setFeedback: (feedback: string | null) => Promise<void>
  clearOverride: () => Promise<void>
  clearAiScore: () => Promise<void>
  refreshGrades: () => void
} {
  const ctx = useContext(ExamReviewContext)
  return {
    active: ctx.active,
    mode: ctx.mode,
    pageId: ctx.pageId,
    studentId: ctx.studentId,
    loadedStudentId: ctx.loadedStudentId,
    // Airtight gate: only surface review data that was loaded for the CURRENTLY
    // selected student. During the switch gap (loadedStudentId still the previous
    // student) this returns null → consumers render loading, never stale data.
    review:
      ctx.active && ctx.loadedStudentId === ctx.studentId
        ? ctx.byComponent[componentId] ?? null
        : null,
    setOverride: (awardedPoints) => ctx.setOverride(componentId, awardedPoints),
    setFeedback: (feedback) => ctx.setFeedback(componentId, feedback),
    clearOverride: () => ctx.clearOverride(componentId),
    clearAiScore: () => ctx.clearAiScore(componentId),
    refreshGrades: ctx.refreshGrades,
  }
}

export function useExamReview() {
  return useContext(ExamReviewContext)
}
