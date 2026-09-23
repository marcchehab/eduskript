/**
 * Pioneer programme: early teachers use Eduskript for free, one year at a time.
 *
 * Rules (decided by the operator, enforced here only where code can):
 * - Only an admin grants the status (/api/admin/users/[id], `pioneer` field).
 * - A grant runs one year. Renewal is again a manual admin grant; whether the
 *   teacher qualifies (used a skript with a class, gave feedback each
 *   semester) is judged by the admin. Nothing here checks those criteria.
 *
 * Storage: no schema of its own. A pioneer is a Subscription with
 * status 'active' on the Plan with slug PIONEER_PLAN_SLUG, no payrexxSubId
 * and currentPeriodEnd = end of the term. User.billingPlan is set to
 * 'pioneer', so every paid gate (src/lib/billing.ts isPaidUser) opens without
 * further changes.
 * - The renewal cron (src/app/api/cron/route.ts, task 0) only charges rows with
 *   a payrexxSubId, so a pioneer is never charged.
 * - Expiry: the cron (task 1) and expireSubscriptionIfNeeded (src/lib/trial.ts,
 *   run on session refresh) cancel an active pioneer subscription past its
 *   end and reset billingPlan to 'free'. Both use pioneerExpiryWhere().
 * - The plan row is created on first grant with isActive=false, so it never
 *   shows up in /api/plans or the billing page's plan grid and cannot be
 *   bought through checkout.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PIONEER_PLAN_SLUG } from '@/lib/billing'

export { PIONEER_PLAN_SLUG }

/** End of a one-year term starting at `from` (calendar year, not 365 days). */
export function pioneerTermEnd(from: Date): Date {
  const end = new Date(from)
  end.setFullYear(end.getFullYear() + 1)
  return end
}

/**
 * Subscription filter for pioneer rows whose term has run out. `OR` branch
 * shape, meant to sit next to the trial/cancelled branches of the expiry
 * queries.
 */
export function pioneerExpiryWhere(): Prisma.SubscriptionWhereInput {
  return { status: 'active', plan: { slug: PIONEER_PLAN_SLUG } }
}

export class PioneerGrantError extends Error {}

/**
 * Grant or renew pioneer status for one year.
 *
 * - Already a pioneer: the term is extended by one year from its current end
 *   (or from now, if that end is already past), so renewing early loses no
 *   days.
 * - Otherwise: cancels a running trial or admin-granted subscription and
 *   starts a new pioneer term now.
 * - Refuses (PioneerGrantError) if the user has a subscription paid through
 *   Payrexx (active or past_due with a payrexxSubId): granting on top would
 *   leave the card being charged. Stop that subscription first.
 * - Refuses for student accounts (they never pay anyway).
 */
export async function grantPioneer(
  userId: string,
  now: Date = new Date()
): Promise<{ currentPeriodEnd: Date; renewed: boolean }> {
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
      select: { id: true, planId: true, status: true, payrexxSubId: true, currentPeriodEnd: true },
    })

    if (current.some((s) => s.payrexxSubId && s.status !== 'trialing')) {
      throw new PioneerGrantError(
        'User has a paid Payrexx subscription. Stop it (or wait for it to end) before granting pioneer status.'
      )
    }

    const existing = current.find((s) => s.planId === plan.id && s.status === 'active')
    if (existing) {
      const base =
        existing.currentPeriodEnd && existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now
      const currentPeriodEnd = pioneerTermEnd(base)
      await tx.subscription.update({
        where: { id: existing.id },
        data: { currentPeriodEnd },
      })
      await tx.user.update({ where: { id: userId }, data: { billingPlan: PIONEER_PLAN_SLUG } })
      return { currentPeriodEnd, renewed: true }
    }

    if (current.length > 0) {
      await tx.subscription.updateMany({
        where: { id: { in: current.map((s) => s.id) } },
        data: { status: 'cancelled', cancelledAt: now },
      })
    }

    const currentPeriodEnd = pioneerTermEnd(now)
    await tx.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd,
      },
    })
    await tx.user.update({ where: { id: userId }, data: { billingPlan: PIONEER_PLAN_SLUG } })
    return { currentPeriodEnd, renewed: false }
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
