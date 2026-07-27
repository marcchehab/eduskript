/**
 * Regression tests for the metrics buffer's DB flush.
 *
 * The two bugs these lock down:
 * 1. The hourly row used to be stamped with the NEW hour, because the flush
 *    read `currentHourTimestamp` after the caller had already advanced it.
 * 2. Samples recorded while a flush was in flight were cleared away.
 *
 * The DB write cadence (DB_FLUSH_INTERVAL_MS, 10 min) is why these tests jump
 * the clock by more than ten minutes rather than by one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const executeRaw = vi.fn(() => Promise.resolve(1))

vi.mock('@/lib/prisma', () => ({
  prismaBase: {
    get $executeRaw() {
      return executeRaw
    },
  },
}))

// The buffer keeps module-level state, so each test needs a fresh instance.
async function freshBuffer() {
  vi.resetModules()
  return import('@/lib/metrics/buffer')
}

/** Params of a tagged-template $executeRaw call: [strings, ...values]. */
function callValues(call: unknown[]) {
  return call.slice(1)
}

beforeEach(() => {
  executeRaw.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('metrics buffer', () => {
  it('stamps the flushed row with the hour the samples belong to', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:30:00.000Z'))
    const { recordMetric } = await freshBuffer()

    recordMetric('db_queries_total', 1)
    recordMetric('db_queries_total', 1)

    // Cross into the next hour and record again, which triggers the flush.
    vi.setSystemTime(new Date('2026-07-27T11:00:05.000Z'))
    recordMetric('db_queries_total', 1)
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalled())

    const [name, timestamp, avg, count] = callValues(executeRaw.mock.calls[0]).slice(1)
    expect(name).toBe('db_queries_total')
    expect((timestamp as Date).toISOString()).toBe('2026-07-27T10:00:00.000Z')
    expect(avg).toBe(1)
    expect(count).toBe(2)
  })

  it('keeps samples recorded during an in-flight flush', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:30:00.000Z'))
    const { recordMetric, stopMetricsFlush } = await freshBuffer()

    let release: (() => void) | undefined
    executeRaw.mockImplementationOnce(
      () => new Promise<number>(resolve => { release = () => resolve(1) })
    )

    recordMetric('db_queries_total', 1)

    // Crossing the flush interval starts a write that has not resolved yet.
    vi.setSystemTime(new Date('2026-07-27T10:41:00.000Z'))
    recordMetric('db_queries_total', 1)
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(1))

    release?.()
    await stopMetricsFlush()

    // Second sample must still reach the DB rather than being cleared away.
    const totalCount = executeRaw.mock.calls
      .map(call => callValues(call)[4] as number)
      .reduce((a, b) => a + b, 0)
    expect(totalCount).toBe(2)
  })

  it('retries the delta when the write fails', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:30:00.000Z'))
    const { recordMetric, stopMetricsFlush } = await freshBuffer()

    executeRaw.mockRejectedValueOnce(new Error('connection lost'))

    recordMetric('db_queries_total', 1)
    vi.setSystemTime(new Date('2026-07-27T10:41:00.000Z'))
    recordMetric('db_queries_total', 1)
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(1))

    await stopMetricsFlush()

    const totalCount = executeRaw.mock.calls
      .slice(1)
      .map(call => callValues(call)[4] as number)
      .reduce((a, b) => a + b, 0)
    expect(totalCount).toBe(2)
  })
})
