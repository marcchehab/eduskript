/**
 * Billing plan gating.
 *
 * Single source of truth for what counts as "paid". Trials count as paid:
 * src/lib/trial.ts sets User.billingPlan to the trial plan's slug, and resets
 * to "free" when the trial expires. So `billingPlan === "free"` is the only
 * non-paid state we need to check.
 *
 * Students are treated as paid: a student account only exists because a paid
 * teacher created the class they joined. Their own User.billingPlan is always
 * "free" (default) but the gating policy follows their teacher.
 */

import { NextResponse } from 'next/server'

export const FREE_PLAN = 'free'

export interface PaidUserLike {
  billingPlan?: string | null
  accountType?: string | null
}

/**
 * True if the user is on a paid (or trial) plan, OR is a student account.
 * Students inherit access through their teacher's paid plan upstream.
 */
export function isPaidUser(user: PaidUserLike | null | undefined): boolean {
  if (!user) return false
  if (user.accountType === 'student') return true
  return Boolean(user.billingPlan) && user.billingPlan !== FREE_PLAN
}

/**
 * True only for free *teacher* accounts. Used at the UI layer to disable
 * paid features. (Anonymous visitors and students don't see these affordances.)
 */
export function isFreeTeacher(user: PaidUserLike | null | undefined): boolean {
  if (!user) return false
  if (user.accountType === 'student') return false
  return !user.billingPlan || user.billingPlan === FREE_PLAN
}

/**
 * Standard 402 response for paid-only API endpoints.
 * Clients can switch on `code === 'paid_only'` to show an upgrade prompt
 * instead of a generic error.
 */
export function paidOnlyResponse(message = 'This feature requires a paid plan.') {
  return NextResponse.json(
    {
      error: message,
      code: 'paid_only',
      upgradeUrl: '/dashboard/billing',
    },
    { status: 402 }
  )
}
