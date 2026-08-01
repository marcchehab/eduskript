/**
 * The prune step deletes rows, so its two retention windows are worth pinning:
 * `path:` rows (one per URL per day, read only 7 days back by the cache warmer)
 * go at 10 days, everything else — the actual metrics, which /api/metrics/history
 * serves for up to 365 days — goes at a year.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const deleteMany = vi.fn(async () => ({ count: 0 }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    user: { updateMany: vi.fn() },
    metricPoint: { get deleteMany() { return deleteMany } },
  },
}))

vi.mock('@/lib/seed-demo-content', () => ({
  resetDemoUser: vi.fn(async () => ({ pageCount: 0 })),
}))

function cronRequest() {
  return new NextRequest('http://localhost/api/cron', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  })
}

/** Days between `date` and now, rounded — the retention window in the call. */
function daysAgo(date: Date) {
  return Math.round((Date.now() - date.getTime()) / 86400000)
}

beforeEach(() => {
  deleteMany.mockClear()
  vi.stubEnv('CRON_SECRET', 'test-secret')
})

describe('POST /api/cron — metric_points pruning', () => {
  it('keeps path rows for 10 days and metrics for a year', async () => {
    const { POST } = await import('@/app/api/cron/route')
    const response = await POST(cronRequest())
    expect(response.status).toBe(200)

    expect(deleteMany).toHaveBeenCalledTimes(2)
    const [pathCall, metricCall] = deleteMany.mock.calls.map(c => (c as never[])[0] as {
      where: { name?: { startsWith?: string }; NOT?: { name: { startsWith: string } }; timestamp: { lt: Date } }
    })

    expect(pathCall.where.name?.startsWith).toBe('path:')
    expect(daysAgo(pathCall.where.timestamp.lt)).toBe(10)

    // The complement, so a new metric name is never silently dropped early.
    expect(metricCall.where.NOT?.name.startsWith).toBe('path:')
    expect(daysAgo(metricCall.where.timestamp.lt)).toBe(365)
  })

  it('rejects an unauthenticated call without deleting anything', async () => {
    const { POST } = await import('@/app/api/cron/route')
    const response = await POST(
      new NextRequest('http://localhost/api/cron', { method: 'POST' })
    )

    expect(response.status).toBe(401)
    expect(deleteMany).not.toHaveBeenCalled()
  })
})
