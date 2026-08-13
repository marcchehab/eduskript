'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { QUEST_STEPS, type QuestState, type QuestStep } from './types'

export interface QuestUpdate {
  state: QuestState
  justGranted: boolean
}

type Listener = (update: QuestUpdate) => void

// Module-level pub/sub so any mounted OnboardingQuestWidget/QuestSpotlight
// picks up a step completion fired from anywhere in the tree, without a
// context provider or prop drilling across the dashboard/public boundary.
const listeners = new Set<Listener>()

export function subscribeQuestUpdates(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Shared read cache + in-flight dedup, so mounting several quest-aware
// components (the widget, spotlight hints) on the same page costs one GET,
// not one each.
let cachedState: QuestState | null = null
let cachedStateLoaded = false
let inFlightFetch: Promise<QuestState | null> | null = null

export function getCachedQuestState(): QuestState | null {
  return cachedState
}

export function fetchQuestState(): Promise<QuestState | null> {
  if (cachedStateLoaded) return Promise.resolve(cachedState)
  if (inFlightFetch) return inFlightFetch

  inFlightFetch = fetch('/api/user-data/onboarding-quest/global')
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      cachedState = (body?.data as QuestState) ?? null
      cachedStateLoaded = true
      return cachedState
    })
    .catch(() => null)
    .finally(() => {
      inFlightFetch = null
    })

  return inFlightFetch
}

/**
 * Force a fresh GET, bypassing the cache, and broadcast the result to every
 * subscriber (the widget + all mounted QuestSpotlights). Needed because
 * bfcache-restored back/forward navigation resumes a frozen React tree
 * without re-running mount effects — the same staleness class handled
 * elsewhere in this codebase by AnnotationLayer's visibility/focus
 * reconciliation (src/components/annotations/annotation-layer.tsx).
 */
export function refreshQuestState(): Promise<QuestState | null> {
  return fetch('/api/user-data/onboarding-quest/global')
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      const state = (body?.data as QuestState) ?? null
      cachedState = state
      cachedStateLoaded = true
      if (state) listeners.forEach((listener) => listener({ state, justGranted: false }))
      return state
    })
    .catch(() => null)
}

async function postQuestAction(body: { step: QuestStep } | { dismiss: true }): Promise<void> {
  try {
    const res = await fetch('/api/onboarding-quest/complete-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return
    const update = (await res.json()) as QuestUpdate
    cachedState = update.state
    cachedStateLoaded = true
    listeners.forEach((listener) => listener(update))
  } catch {
    // Fire-and-forget — a missed step completion just means the widget's
    // next successful call (or its own poll) reconciles the true state.
  }
}

/**
 * completeStep/dismissQuest no-op instantly (no fetch) for non-teacher
 * sessions — this is what keeps the quest's cost at zero for the vast
 * majority of scattered call sites (student viewers, anonymous visitors).
 */
export function useQuestStep(): { completeStep: (step: QuestStep) => void; dismissQuest: () => void } {
  const { data: session } = useSession()
  const isTeacher = session?.user?.accountType === 'teacher'

  const completeStep = useCallback(
    (step: QuestStep) => {
      if (!isTeacher) return
      void postQuestAction({ step })
    },
    [isTeacher]
  )

  const dismissQuest = useCallback(() => {
    if (!isTeacher) return
    void postQuestAction({ dismiss: true })
  }, [isTeacher])

  return { completeStep, dismissQuest }
}

/**
 * The first not-yet-completed quest step, for "point at the next thing to
 * do" hints (QuestSpotlight). Null for non-teachers, a dismissed/finished
 * quest, or while state hasn't loaded yet — all of which just render no hint.
 */
export function useNextIncompleteStep(): QuestStep | null {
  const { data: session } = useSession()
  const isTeacher = session?.user?.accountType === 'teacher'
  const [state, setState] = useState<QuestState | null>(getCachedQuestState())

  useEffect(() => {
    if (!isTeacher) return
    let cancelled = false
    fetchQuestState().then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [isTeacher])

  useEffect(() => {
    return subscribeQuestUpdates((update) => setState(update.state))
  }, [])

  if (!isTeacher || !state || state.dismissed || state.rewardGranted) return null
  return QUEST_STEPS.find((step) => !state.completedSteps[step]) ?? null
}
