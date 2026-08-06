/**
 * Unified cron endpoint — runs all scheduled tasks in sequence.
 * Called daily by GitHub Actions (or any external scheduler).
 *
 * Auth: Bearer token must match CRON_SECRET env var.
 *
 * Tasks:
 * - Expire trials and cancelled subscriptions past their end date
 * - Reset demo user content from demo-content/ files
 * - Prune old metric_points and db_activity_hours rows
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resetDemoUser } from '@/lib/seed-demo-content'
import { PATH_METRIC_PREFIX } from '@/lib/metrics/buffer'


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

  // --- Task 3: Prune old metric_points rows ---
  // Two retentions, because the table holds two different things:
  //
  // `path:` rows are one per distinct URL per day (vulnerability scanners
  // included) and the only reader — the cache warmer — looks back 7 days, so
  // 10 days is already slack. The real metrics are three names at ~72 rows a
  // day and /api/metrics/history accepts up to 365 days, so they keep a year.
  //
  // Runs here because this job already has the database awake; a job of its own
  // would cost an extra wake window on an instance that bills awake-time.
  try {
    const now = Date.now()
    const pathCutoff = new Date(now - 10 * 86400000)
    const metricCutoff = new Date(now - 365 * 86400000)

    const [prunedPaths, prunedMetrics, prunedActivity] = await Promise.all([
      prisma.metricPoint.deleteMany({
        where: { name: { startsWith: PATH_METRIC_PREFIX }, timestamp: { lt: pathCutoff } },
      }),
      prisma.metricPoint.deleteMany({
        where: { NOT: { name: { startsWith: PATH_METRIC_PREFIX } }, timestamp: { lt: metricCutoff } },
      }),
      // 24 rows a day, so a year is under 9k rows; same retention as the
      // metrics it sits beside.
      prisma.dbActivityHour.deleteMany({ where: { hour: { lt: metricCutoff } } }),
    ])

    results.prunedMetricPoints = {
      paths: prunedPaths.count,
      metrics: prunedMetrics.count,
      activityHours: prunedActivity.count,
    }
  } catch (error) {
    console.error('[cron] prune-metrics error:', error)
    results.prunedMetricPoints = 'error'
  }

  return NextResponse.json({ success: true, results })
}
