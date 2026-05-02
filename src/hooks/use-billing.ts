'use client'

import { useSession } from 'next-auth/react'
import { isFreeTeacher, isPaidUser } from '@/lib/billing'

/**
 * Client-side billing-plan checks. Reads from the NextAuth session, which is
 * refreshed from DB on every session lookup (see src/lib/auth.ts).
 *
 * Use these to drive UI affordances — the *security* gate is on the API.
 */
export function useIsFreeTeacher(): boolean {
  const { data: session } = useSession()
  return isFreeTeacher(session?.user)
}

export function useIsPaid(): boolean {
  const { data: session } = useSession()
  return isPaidUser(session?.user)
}
