/**
 * The point of storing per-minute masks rather than a query count is that the
 * managed Postgres bills on GAPS, not on volume. These tests pin the three
 * things that made the extra table worth it: overlapping suspend windows must
 * not double-count, a query near the end of an hour must keep the next hour
 * awake, and a burst must cost the same as a single query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prismaBase: { dbActivityHour: { findMany: (...args: unknown[]) => findMany(...args) } },
}))

/** Build a row whose given minutes-of-hour are marked active. */
function row(hourIso: string, minutes: number[]) {
  let mask = 0n
  for (const m of minutes) mask |= 1n << BigInt(m)
  return { hour: new Date(hourIso), minutes: mask, updatedAt: new Date(hourIso) }
}

beforeEach(() => {
  findMany.mockReset()
})

describe('getAwakeWindow', () => {
  it('expands a single query into the suspend delay', async () => {
    findMany.mockResolvedValue([row('2026-08-06T10:00:00Z', [0])])
    const { getAwakeWindow } = await import('@/lib/metrics/db-awake')

    const w = await getAwakeWindow(new Date('2026-08-06T10:00:00Z'), new Date('2026-08-06T11:00:00Z'))
    expect(w.activeMinutes).toBe(1)
    expect(w.awakeMinutes).toBe(5)
  })

  it('does not double-count overlapping suspend windows', async () => {
    // Four queries a minute apart. Naively 4 x 5 = 20 minutes; the union is 8.
    findMany.mockResolvedValue([row('2026-08-06T10:00:00Z', [0, 1, 2, 3])])
    const { getAwakeWindow } = await import('@/lib/metrics/db-awake')

    const w = await getAwakeWindow(new Date('2026-08-06T10:00:00Z'), new Date('2026-08-06T11:00:00Z'))
    expect(w.activeMinutes).toBe(4)
    expect(w.awakeMinutes).toBe(8)
  })

  it('costs the same for a burst as for one query', async () => {
    findMany.mockResolvedValue([row('2026-08-06T10:00:00Z', [30])])
    const { getAwakeWindow } = await import('@/lib/metrics/db-awake')
    const burst = await getAwakeWindow(new Date('2026-08-06T10:00:00Z'), new Date('2026-08-06T11:00:00Z'))

    // A thousand queries within one minute set exactly the same bit.
    expect(burst.awakeMinutes).toBe(5)
  })

  it('is far more expensive when the same query count is spread out', async () => {
    // 12 queries, one every 5 minutes: never a gap long enough to suspend.
    findMany.mockResolvedValue([row('2026-08-06T10:00:00Z', [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])])
    const { getAwakeWindow } = await import('@/lib/metrics/db-awake')

    const w = await getAwakeWindow(new Date('2026-08-06T10:00:00Z'), new Date('2026-08-06T11:00:00Z'))
    expect(w.activeMinutes).toBe(12)
    expect(w.awakeMinutes).toBe(60)
  })

  it('carries the tail of an activity across the hour boundary', async () => {
    // A query at 10:59 keeps the instance up until 11:03.
    findMany.mockResolvedValue([row('2026-08-06T10:00:00Z', [59])])
    const { getAwakeWindow } = await import('@/lib/metrics/db-awake')

    const w = await getAwakeWindow(new Date('2026-08-06T11:00:00Z'), new Date('2026-08-06T12:00:00Z'))
    // The query itself is outside the window, its tail is not.
    expect(w.activeMinutes).toBe(0)
    expect(w.awakeMinutes).toBe(4)
  })

  it('reports zero for a window with no recorded activity', async () => {
    findMany.mockResolvedValue([])
    const { getAwakeWindow } = await import('@/lib/metrics/db-awake')

    const w = await getAwakeWindow(new Date('2026-08-06T10:00:00Z'), new Date('2026-08-06T11:00:00Z'))
    expect(w.awakeMinutes).toBe(0)
    expect(w.totalMinutes).toBe(60)
    expect(w.fraction).toBe(0)
  })
})

describe('getAwakeHours', () => {
  it('splits awake minutes into the hours they fall in', async () => {
    findMany.mockResolvedValue([row('2026-08-06T10:00:00Z', [58])])
    const { getAwakeHours } = await import('@/lib/metrics/db-awake')

    const hours = await getAwakeHours(new Date('2026-08-06T10:00:00Z'), new Date('2026-08-06T12:00:00Z'))
    expect(hours).toHaveLength(2)
    // 10:58 and 10:59 in the first hour, 11:00-11:02 in the second.
    expect(hours[0].awakeMinutes).toBe(2)
    expect(hours[1].awakeMinutes).toBe(3)
  })
})
