/**
 * Metrics History API
 *
 * GET /api/metrics/history - Get historical metrics from database
 *
 * Query params:
 * - days: number of days to fetch (default: 7, max: 365)
 * - metric: optional specific metric name
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getMetricDailyAggregates } from '@/lib/metrics/aggregation'
import { PATH_METRIC_PREFIX } from '@/lib/metrics/buffer'

export async function GET(request: NextRequest) {
  // Check authentication and admin status
  const session = await getServerSession(authOptions)
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(parseInt(searchParams.get('days') || '7'), 365)
  const metricName = searchParams.get('metric')

  const since = new Date()
  since.setDate(since.getDate() - days)

  try {
    // If specific metric requested, return daily aggregates
    if (metricName) {
      const dailyData = await getMetricDailyAggregates(metricName, days)
      return NextResponse.json({ metric: metricName, days, data: dailyData })
    }

    // Otherwise return hourly data for all metrics
    const points = await prisma.metricPoint.findMany({
      where: {
        timestamp: { gte: since },
        // Per-URL request counts share this table (see PATH_METRIC_PREFIX in
        // metrics/buffer.ts) but are not metrics — they feed the cache warmer,
        // and there are hundreds of them.
        NOT: { name: { startsWith: PATH_METRIC_PREFIX } },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        name: true,
        timestamp: true,
        avg: true,
        count: true,
      },
    })

    // Group by metric name for easier frontend consumption
    const byMetric: Record<string, Array<{ timestamp: string; avg: number; count: number }>> = {}

    for (const point of points) {
      if (!byMetric[point.name]) {
        byMetric[point.name] = []
      }
      byMetric[point.name].push({
        timestamp: point.timestamp.toISOString(),
        avg: point.avg,
        count: point.count,
      })
    }

    return NextResponse.json({ days, metrics: byMetric })
  } catch (error) {
    console.error('[Metrics API] Error fetching history:', error)
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 })
  }
}
