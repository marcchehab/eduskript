'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { useSyncedUserData } from '@/lib/userdata'
import { cn } from '@/lib/utils'

/**
 * SurveyContext — populated only when a page contains `<Survey>` regions.
 *
 * `<Question>` components consult this context: if it's set, they render in
 * survey mode (per-question Save click + page-level Send button; no
 * correctness feedback).
 *
 * **Persistence model:** each question's draft answer goes through
 * `useSyncedUserData` with `localOnly: true`, exactly like code editors and
 * personal annotations do for not-logged-in users. The sync engine skips
 * `localOnly` records, so anonymous visitors get IndexedDB persistence
 * across refresh without their answers ever leaving the browser; the
 * overall "Send" button is the only path that POSTs to the server.
 *
 * Survey-level metadata (sessionId, last-sent signature, submittedAt)
 * lives in a separate `'survey-meta'` userdata record on the same page,
 * also `localOnly`. Only `sessionId` stays in localStorage because it's a
 * browser-stable identifier (acts like a cookie for survey deduplication).
 */

export type SurveyAnswerType = 'single' | 'multiple' | 'text' | 'number' | 'range'

export interface SurveyAnswer {
  questionId: string
  type: SurveyAnswerType
  value: unknown
}

interface SurveyMeta {
  /** Stable JSON form of the answers map at the last successful Send. */
  lastSentSignature: string
  /** ISO timestamp of the last successful Send. */
  submittedAt: string
}

export interface SurveyContextValue {
  /** The pageId this survey belongs to. = survey identity. */
  pageId: string
  /** Stable per-browser-session UUID; used as dedup key on the server. */
  sessionId: string
  /** Register or update an answer for a given questionId. SurveyQuestion calls this from its updateData wrapper (i.e. on per-question Save) AND once on hydration so the provider knows what useSyncedUserData restored. */
  registerAnswer: (questionId: string, type: SurveyAnswerType, value: unknown) => void
  /** True when an authenticated session is present. Logged-in users' Send submissions are dropped server-side. */
  isAuthenticated: boolean
  /** Submission lifecycle state for the page-level Send action. */
  submitState: 'idle' | 'submitting' | 'submitted' | 'error'
  /** True if the visitor has already submitted at least once. Distinguishes "first send" from "resend". */
  hasSubmittedOnce: boolean
  /** True if this question has a saved answer (used for the answered counter). */
  hasAnswer: (questionId: string) => boolean
  /** True when the viewer has edit rights on the survey page (resolved via /survey-meta). */
  isAuthor: boolean
  /** ClassId for this page's implicit survey class, or null until the first response lands. */
  implicitClassId: string | null
  /** Cached respondent count for author UI. */
  responseCount: number
}

const SurveyContext = createContext<SurveyContextValue | null>(null)

export function useSurvey(): SurveyContextValue | null {
  return useContext(SurveyContext)
}

const SESSION_STORAGE_KEY = (pageId: string) => `survey:${pageId}:sessionId`

function readOrCreateSessionId(pageId: string): string {
  if (typeof window === 'undefined') return ''
  const key = SESSION_STORAGE_KEY(pageId)
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const fresh = (window.crypto && 'randomUUID' in window.crypto)
    ? window.crypto.randomUUID()
    : `survey-${Date.now()}-${Math.random().toString(36).slice(2)}`
  window.localStorage.setItem(key, fresh)
  return fresh
}

/**
 * Stable JSON form of a Map of answers, used to compare "current state" to
 * "what was at the last successful Send". Keys sorted alphabetically so
 * insertion order doesn't make equivalent states compare as different.
 * Only the `value` is compared (the `type` is stable per questionId).
 */
function serializeForCompare(answers: Map<string, SurveyAnswer>): string {
  return JSON.stringify(
    Array.from(answers.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v.value])
  )
}

export function SurveyProvider({ pageId, children }: { pageId: string; children: ReactNode }) {
  const { status } = useSession()
  const isAuthenticated = status === 'authenticated'

  // Stable session ID per browser per page. Survives reloads via localStorage —
  // this is a browser-level identifier, like a cookie, not application state.
  const [sessionId, setSessionId] = useState<string>('')
  useEffect(() => {
    setSessionId(readOrCreateSessionId(pageId))
  }, [pageId])

  // In-memory mirror of saved answers. Populated by SurveyQuestion calling
  // registerAnswer on its per-question Save AND once on hydration after
  // useSyncedUserData restores its value from IndexedDB. Used for the
  // page-level Send POST payload and the answered counter.
  const answersRef = useRef<Map<string, SurveyAnswer>>(new Map())
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set())
  const [currentSignature, setCurrentSignature] = useState<string>('[]')

  // Survey-level metadata: lastSentSignature + submittedAt. Stored via
  // useSyncedUserData like everything else (localOnly so it never syncs to
  // server). componentId 'survey-meta' is reserved per page for this.
  const { data: surveyMeta, updateData: updateSurveyMeta } =
    useSyncedUserData<SurveyMeta | null>(pageId, 'survey-meta', null, { localOnly: true })

  const hasSubmittedOnce = Boolean(surveyMeta?.submittedAt)
  const lastSentSignature = surveyMeta?.lastSentSignature ?? null

  // Submission state (transient — not persisted)
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const isNonEmpty = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim().length > 0
    if (typeof value === 'number') return true
    if (value && typeof value === 'object') return true
    return false
  }

  const registerAnswer = useCallback((questionId: string, type: SurveyAnswerType, value: unknown) => {
    const wasInSet = answeredIds.has(questionId)
    const nowNonEmpty = isNonEmpty(value)

    if (nowNonEmpty) {
      answersRef.current.set(questionId, { questionId, type, value })
    } else {
      answersRef.current.delete(questionId)
    }

    setCurrentSignature(serializeForCompare(answersRef.current))

    if (wasInSet !== nowNonEmpty) {
      setAnsweredIds((prev) => {
        const next = new Set(prev)
        if (nowNonEmpty) next.add(questionId)
        else next.delete(questionId)
        return next
      })
    }

    setSubmitState((cur) => (cur === 'submitted' ? 'idle' : cur))
  }, [answeredIds])

  const hasAnswer = useCallback((questionId: string) => answeredIds.has(questionId), [answeredIds])

  // Author/respondent-count resolution (orthogonal to per-question state)
  const [isAuthor, setIsAuthor] = useState(false)
  const [implicitClassId, setImplicitClassId] = useState<string | null>(null)
  const [responseCount, setResponseCount] = useState(0)
  useEffect(() => {
    if (!pageId) return
    let cancelled = false
    fetch(`/api/pages/${encodeURIComponent(pageId)}/survey-meta`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (cancelled || !meta) return
        if (meta.isAuthor) {
          setIsAuthor(true)
          setImplicitClassId(meta.implicitClassId ?? null)
          setResponseCount(meta.responseCount ?? 0)
        } else {
          setIsAuthor(false)
          setImplicitClassId(null)
          setResponseCount(0)
        }
      })
      .catch((err) => console.warn('[Survey] survey-meta endpoint fetch failed:', err))
    return () => {
      cancelled = true
    }
  }, [pageId])

  const handleSubmit = useCallback(async () => {
    if (submitState === 'submitting') return
    if (isAuthenticated) return
    if (!sessionId || !pageId) return
    if (answersRef.current.size === 0) return

    setSubmitState('submitting')
    setSubmitError(null)

    const answers = Array.from(answersRef.current.values())

    try {
      const res = await fetch('/api/survey-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, sessionId, answers }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Server responded ${res.status}`)
      }

      // Snapshot the just-sent state into the survey-meta userdata record so
      // refresh restores the "settled after send" indicator correctly.
      const sentSig = serializeForCompare(answersRef.current)
      await updateSurveyMeta(
        { lastSentSignature: sentSig, submittedAt: new Date().toISOString() },
        { immediate: true }
      )

      setSubmitState('submitted')
    } catch (err) {
      console.error('[Survey] Submission failed:', err)
      setSubmitError(err instanceof Error ? err.message : 'Unknown error')
      setSubmitState('error')
    }
  }, [submitState, isAuthenticated, sessionId, pageId, updateSurveyMeta])

  const value = useMemo<SurveyContextValue>(() => ({
    pageId,
    sessionId,
    registerAnswer,
    isAuthenticated,
    submitState,
    hasSubmittedOnce,
    hasAnswer,
    isAuthor,
    implicitClassId,
    responseCount,
  }), [pageId, sessionId, registerAnswer, isAuthenticated, submitState, hasSubmittedOnce, hasAnswer, isAuthor, implicitClassId, responseCount])

  return (
    <SurveyContext.Provider value={value}>
      {children}
      <SurveyFooter
        isAuthenticated={isAuthenticated}
        submitState={submitState}
        submitError={submitError}
        answerCount={answeredIds.size}
        hasSubmittedOnce={hasSubmittedOnce}
        isDirty={lastSentSignature !== null && currentSignature !== lastSentSignature}
        onSubmit={handleSubmit}
        isAuthor={isAuthor}
        implicitClassId={implicitClassId}
        responseCount={responseCount}
        pageId={pageId}
      />
    </SurveyContext.Provider>
  )
}

function SurveyFooter({
  isAuthenticated,
  submitState,
  submitError,
  answerCount,
  hasSubmittedOnce,
  isDirty,
  onSubmit,
  isAuthor,
  implicitClassId,
  responseCount,
  pageId,
}: {
  isAuthenticated: boolean
  submitState: 'idle' | 'submitting' | 'submitted' | 'error'
  submitError: string | null
  answerCount: number
  hasSubmittedOnce: boolean
  isDirty: boolean
  onSubmit: () => void
  isAuthor: boolean
  implicitClassId: string | null
  responseCount: number
  pageId: string
}) {
  if (isAuthor) {
    const csvHref = `/api/survey-responses/export?pageId=${encodeURIComponent(pageId)}`
    return (
      <div className="my-8 p-4 rounded-lg border border-blue-500/40 bg-blue-500/5">
        <p className="font-medium text-blue-700 dark:text-blue-400">
          Survey preview (you author this page)
        </p>
        <p className="text-muted-foreground text-sm mt-1">
          Anonymous visitors see a Send button. Your own input isn&rsquo;t
          recorded — per-question response totals appear below each question.
        </p>
        <p className="text-sm mt-3">
          <strong>{responseCount}</strong> response{responseCount === 1 ? '' : 's'} collected.
          {implicitClassId && responseCount > 0 && (
            <>
              {' · '}
              <a className="underline text-blue-700 dark:text-blue-400" href={csvHref}>
                Download as CSV
              </a>
            </>
          )}
        </p>
      </div>
    )
  }

  if (isAuthenticated) {
    return (
      <div className="my-8 p-4 rounded-lg border border-amber-500/40 bg-amber-500/5 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-400">
          You&rsquo;re signed in — your answers won&rsquo;t be saved.
        </p>
        <p className="text-muted-foreground mt-1">
          Surveys only record anonymous responses. Sign out or open this page
          in a private window to participate.
        </p>
      </div>
    )
  }

  // Button state machine:
  //   - nothing answered yet      → "Send", disabled
  //   - answers exist, not sent   → "Send", enabled, "X question(s) answered"
  //   - sent, no edits since      → grayed, "X question(s) answered"
  //   - sent, edits since         → "Resend (X answered, modified)"
  //   - in flight                 → "Sending…", disabled
  const isSubmitting = submitState === 'submitting'
  const noAnswersYet = answerCount === 0
  const settledAfterSend = hasSubmittedOnce && !isDirty

  let buttonLabel: string
  let isDisabled: boolean

  // Button shows the action/status word only; the answered-count and any
  // modifier ("modified") live in the side-label so the two slots don't
  // compete with each other across states.
  if (isSubmitting) {
    buttonLabel = 'Sending…'
    isDisabled = true
  } else if (!hasSubmittedOnce) {
    buttonLabel = 'Send'
    isDisabled = noAnswersYet
  } else if (settledAfterSend) {
    buttonLabel = 'Sent'
    isDisabled = true
  } else {
    buttonLabel = 'Resend'
    isDisabled = false
  }

  const sideLabel: string | null = answerCount === 0
    ? null
    : `${answerCount} question${answerCount === 1 ? '' : 's'} answered${
        hasSubmittedOnce && !settledAfterSend ? ', modified' : ''
      }`

  return (
    <div className="my-8 flex flex-col items-start gap-3">
      {submitState === 'submitted' && (
        <div className="text-sm text-green-700 dark:text-green-400 font-medium">
          Thanks — your answers were submitted anonymously.
          You can save individual answers afterwards and resend.
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isDisabled}
          className={cn(
            'px-6 py-3 rounded-lg font-medium transition-colors',
            'bg-primary text-primary-foreground',
            isDisabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-primary/90'
          )}
        >
          {buttonLabel}
        </button>
        {sideLabel && (
          <span className="text-sm text-muted-foreground">{sideLabel}</span>
        )}
      </div>

      {submitState === 'error' && submitError && (
        <p className="text-sm text-destructive">
          Send failed: {submitError}. Please try again.
        </p>
      )}
    </div>
  )
}
