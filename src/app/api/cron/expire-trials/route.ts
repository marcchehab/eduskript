/**
 * Cron endpoint to batch-expire subscriptions past their end date.
 * Handles both expired trials and cancelled paid subscriptions past their period.
 * Intended to run daily via Koyeb cron or similar scheduler.
 *
 * Auth: Bearer token must match CRON_SECRET env var.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()

    // Find all subscriptions that should be expired:
    // - Trials past their end date
    // - Cancelled paid subscriptions past their period end
    const expired = await prisma.subscription.findMany({
      where: {
        currentPeriodEnd: { lt: now },
        OR: [
          { status: 'trialing' },
          { status: 'active', cancelledAt: { not: null } },
        ],
      },
      select: { id: true, userId: true, cancelledAt: true },
    })

    if (expired.length === 0) {
      return NextResponse.json({ expired: 0 })
    }

    // Batch update subscriptions
    await prisma.subscription.updateMany({
      where: {
        id: { in: expired.map((s) => s.id) },
      },
      data: {
        status: 'cancelled',
        cancelledAt: now,
      },
    })

    // Reset each user's billingPlan to 'free'
    const userIds = [...new Set(expired.map((s) => s.userId))]
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { billingPlan: 'free' },
    })

    return NextResponse.json({ expired: expired.length, userIds })
  } catch (error) {
    console.error('[cron/expire-subscriptions] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
