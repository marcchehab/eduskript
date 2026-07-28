/**
 * Unified cron endpoint — runs all scheduled tasks in sequence.
 * Called daily by GitHub Actions (or any external scheduler).
 *
 * Auth: Bearer token must match CRON_SECRET env var.
 *
 * Tasks:
 * - Expire trials and cancelled subscriptions past their end date
 * - Reset demo user content from demo-content/ files
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resetDemoUser } from '@/lib/seed-demo-content'


export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}

  // --- Task 1: Expire trials and cancelled subscriptions ---
  try {
    const now = new Date()
    const expired = await prisma.subscription.findMany({
      where: {
        currentPeriodEnd: { lt: now },
        OR: [
          { status: 'trialing' },
          { status: 'active', cancelledAt: { not: null } },
        ],
      },
      select: { id: true, userId: true },
    })

    if (expired.length > 0) {
      await prisma.subscription.updateMany({
        where: { id: { in: expired.map(s => s.id) } },
        data: { status: 'cancelled', cancelledAt: now },
      })

      const userIds = [...new Set(expired.map(s => s.userId))]
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { billingPlan: 'free' },
      })

      results.expiredSubscriptions = expired.length
    } else {
      results.expiredSubscriptions = 0
    }
  } catch (error) {
    console.error('[cron] expire-subscriptions error:', error)
    results.expiredSubscriptions = 'error'
  }

  // --- Task 2: Reset demo user content ---
  // Deletes the demo user and rebuilds it, so anything a visitor created
  // during the day goes with it. See resetDemoUser().
  try {
    const result = await resetDemoUser(prisma)
    results.demoReset = { pageCount: result.pageCount }
  } catch (error) {
    console.error('[cron] reset-demo error:', error)
    results.demoReset = 'error'
  }

  return NextResponse.json({ success: true, results })
}
