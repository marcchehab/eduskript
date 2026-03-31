/**
 * Trial subscription management.
 *
 * A trial is a Subscription record with status 'trialing' and a finite
 * currentPeriodEnd. No Payrexx involvement until the user converts to paid.
 */

import { prisma } from '@/lib/prisma'

/**
 * Create a trial subscription for a user.
 *
 * - Skips if user already has an active or trialing subscription.
 * - If no planId given, uses the plan with isDefaultTrial=true.
 * - Returns the subscription, or null if no trial plan configured / already subscribed.
 */
export async function createTrialSubscription(
  userId: string,
  planId?: string,
  overrideDays?: number
): Promise<{ id: string } | null> {
  // Check no existing active/trialing subscription
  const existing = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ['active', 'trialing'] },
    },
  })
  if (existing) return null

  // Resolve plan
  const plan = planId
    ? await prisma.plan.findUnique({ where: { id: planId } })
    : await prisma.plan.findFirst({ where: { isDefaultTrial: true, isActive: true } })

  if (!plan) return null

  const trialDays = overrideDays ?? plan.trialDays ?? 14
  const now = new Date()
  const end = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)

  const subscription = await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: 'trialing',
      currentPeriodStart: now,
      currentPeriodEnd: end,
    },
  })

  await prisma.user.update({
    where: { id: userId },
    data: { billingPlan: plan.slug },
  })

  return { id: subscription.id }
}

/**
 * Expire subscriptions that have passed their currentPeriodEnd:
 * - Trials (status 'trialing') past their end date
 * - Cancelled paid subscriptions (status 'active', cancelledAt set) past their period end
 *
 * Returns true if a subscription was expired.
 */
export async function expireSubscriptionIfNeeded(userId: string): Promise<boolean> {
  const now = new Date()

  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      currentPeriodEnd: { lt: now },
      OR: [
        { status: 'trialing' },
        { status: 'active', cancelledAt: { not: null } },
      ],
    },
  })

  if (!sub) return false

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: 'cancelled',
      cancelledAt: sub.cancelledAt ?? now,
    },
  })

  await prisma.user.update({
    where: { id: userId },
    data: { billingPlan: 'free' },
  })

  return true
}

/** @deprecated Use expireSubscriptionIfNeeded instead */
export const expireTrialIfNeeded = expireSubscriptionIfNeeded
