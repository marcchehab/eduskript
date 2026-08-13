/**
 * Decides when to mount the onboarding quest widget.
 *
 * Cheap check only (useSession(), already fetched by SessionProvider for
 * every route) — unlike NicknameModalGate this can't also cheaply know
 * "already done" from localStorage (quest state must survive across origins:
 * dashboard vs. a teacher's custom-domain public page), so the inner widget
 * does its own fetch once mounted. See src/components/onboarding/quest-widget.tsx.
 */
'use client'

import { useSession } from 'next-auth/react'
import { OnboardingQuestWidget } from './quest-widget'

export function OnboardingQuestGate() {
  const { data: session, status } = useSession()

  if (status !== 'authenticated') return null
  if (session?.user?.accountType !== 'teacher') return null

  return <OnboardingQuestWidget />
}
