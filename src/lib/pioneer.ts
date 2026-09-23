/**
 * Pioneer programme: early teachers use Eduskript for free.
 *
 * Fully manual: only an admin grants the status and only an admin ends it
 * (/api/admin/users/[id], `pioneer` field). There is no end date and no
 * automatic expiry. Whether a pioneer still qualifies (uses a skript with a
 * class, gives feedback each semester) is judged by the admin; nothing here
 * checks it.
 *
 * Storage: no schema of its own. A pioneer is a Subscription with
 * status 'active' on the Plan with slug PIONEER_PLAN_SLUG, no payrexxSubId,
 * currentPeriodStart = grant date and currentPeriodEnd = null.
 * User.billingPlan is set to 'pioneer', so every paid gate
 * (src/lib/billing.ts isPaidUser) opens without further changes.
 * - Never charged: the renewal cron (src/app/api/cron/route.ts, task 0) only
 *   charges rows with a payrexxSubId and a past currentPeriodEnd.
 * - Never expired: the expiry paths (cron task 1, src/lib/trial.ts
 *   expireSubscriptionIfNeeded) only match rows with a past currentPeriodEnd.
 * - Not self-cancellable: /api/subscriptions/cancel refuses pioneer rows.
 * - The plan row is created on first grant with isActive=false, so it never
 *   shows up in /api/plans or the billing page's plan grid and cannot be
 *   bought through checkout.
 */

import { prisma } from '@/lib/prisma'
import { PIONEER_PLAN_SLUG } from '@/lib/billing'

export { PIONEER_PLAN_SLUG }

export class PioneerGrantError extends Error {}

/**
 * Make a user a pioneer, open-ended.
 *
 * - Already a pioneer: no-op, returns alreadyPioneer: true.
 * - Otherwise cancels a running trial or admin-granted subscription and
 *   starts the pioneer subscription now.
 * - Refuses (PioneerGrantError) if the user has a subscription paid through
 *   Payrexx (active or past_due with a payrexxSubId): granting on top would
 *   leave the card being charged. Stop that subscription first.
 * - Refuses for student accounts (they never pay anyway).
 */
export async function grantPioneer(
  userId: string,
  now: Date = new Date()
): Promise<{ alreadyPioneer: boolean }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { accountType: true },
    })
    if (!user) throw new PioneerGrantError('User not found')
    if (user.accountType === 'student') {
      throw new PioneerGrantError('Students cannot be pioneers')
    }

    const plan = await tx.plan.upsert({
      where: { slug: PIONEER_PLAN_SLUG },
      update: {},
      create: {
        slug: PIONEER_PLAN_SLUG,
        name: 'Pioneer',
        priceChf: 0,
        interval: 'yearly',
        features: {},
        isActive: false,
      },
    })

    const current = await tx.subscription.findMany({
      where: { userId, status: { in: ['active', 'trialing', 'past_due'] } },
      select: { id: true, planId: true, status: true, payrexxSubId: true },
    })

    if (current.some((s) => s.planId === plan.id && s.status === 'active')) {
      return { alreadyPioneer: true }
    }

    if (current.some((s) => s.payrexxSubId && s.status !== 'trialing')) {
      throw new PioneerGrantError(
        'User has a paid Payrexx subscription. Stop it (or wait for it to end) before granting pioneer status.'
      )
    }

    if (current.length > 0) {
      await tx.subscription.updateMany({
        where: { id: { in: current.map((s) => s.id) } },
        data: { status: 'cancelled', cancelledAt: now },
      })
    }

    await tx.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: 'active',
        currentPeriodStart: now,
      },
    })
    await tx.user.update({ where: { id: userId }, data: { billingPlan: PIONEER_PLAN_SLUG } })
    return { alreadyPioneer: false }
  })
}

/**
 * End pioneer status now: cancels the pioneer subscription and resets
 * billingPlan to 'free'. Returns false if the user was not a pioneer.
 */
export async function revokePioneer(userId: string, now: Date = new Date()): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.subscription.updateMany({
      where: { userId, status: 'active', plan: { slug: PIONEER_PLAN_SLUG } },
      data: { status: 'cancelled', cancelledAt: now },
    })
    if (count === 0) return false
    await tx.user.update({ where: { id: userId }, data: { billingPlan: 'free' } })
    return true
  })
}
