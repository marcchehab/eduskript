/**
 * Database awake-time API
 *
 * GET /api/metrics/db-awake?hours=24 — how much of the window the managed
 * Postgres was awake, which is what it bills for. See src/lib/metrics/db-awake.ts
 * for how the estimate is built and what it cannot see.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAwakeWindow, getAwakeHours, SUSPEND_MINUTES } from '@/lib/metrics/db-awake'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  // 7 days of hourly buckets is 168 points — still cheap to compute and plot.
  const hours = Math.min(Math.max(parseInt(searchParams.get('hours') || '24', 10) || 24, 1), 168)

  const to = new Date()
  const from = new Date(to.getTime() - hours * 3600000)

  try {
    const [window, byHour] = await Promise.all([
      getAwakeWindow(from, to),
      getAwakeHours(from, to),
    ])

    return NextResponse.json({
      hours,
      suspendMinutes: SUSPEND_MINUTES,
      window: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        awakeMinutes: window.awakeMinutes,
        totalMinutes: window.totalMinutes,
        activeMinutes: window.activeMinutes,
        fraction: window.fraction,
      },
      byHour: byHour.map(h => ({
        hour: h.hour.toISOString(),
        awakeMinutes: h.awakeMinutes,
        activeMinutes: h.activeMinutes,
      })),
    })
  } catch (error) {
    console.error('Error computing DB awake time:', error)
    return NextResponse.json({ error: 'Failed to compute awake time' }, { status: 500 })
  }
}
