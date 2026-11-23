/**
 * Decides when to mount the `NicknameModal`.
 *
 * Trigger conditions (both must hold):
 *  - Session present AND `accountType === 'student'`.
 *  - `localStorage[NICKNAME_PROMPT_FLAG]` is absent.
 *
 * Once a student dismisses the modal (either button), the flag is set and the
 * modal never reopens on that device. Clearing localStorage re-prompts — that's
 * acceptable since dismissal is one click.
 *
 * No DB column tracks "has seen the modal" per user preference. The trade-off
 * is per-device prompting; given the modal's cost (one click), this is fine.
 */
'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { NicknameModal, NICKNAME_PROMPT_FLAG } from './nickname-modal'

// Reads the dismissal flag; false on the server and when storage is blocked.
function promptNotSeen(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(NICKNAME_PROMPT_FLAG) !== '1'
  } catch {
    return false
  }
}

export function NicknameModalGate() {
  const { data: session, status } = useSession()
  const [dismissed, setDismissed] = useState(false)
  // Read on every render, not latched at mount: the nickname join form
  // (src/components/auth/nickname-login-form.tsx) sets the flag right before a
  // client-side navigation, while this gate stays mounted. Those students chose
  // their nickname already, and it is their sign-in name (no renaming).
  const shouldOpen = promptNotSeen()

  if (dismissed || !shouldOpen) return null
  if (status !== 'authenticated') return null
  if (session?.user?.accountType !== 'student') return null

  const initialName = session?.user?.name ?? 'Student'
  return <NicknameModal initialName={initialName} onDismiss={() => setDismissed(true)} />
}
