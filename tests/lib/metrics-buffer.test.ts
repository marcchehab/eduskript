/**
 * Regression tests for the metrics buffer's DB persistence.
 *
 * Persistence is opportunistic: nothing is written on a timer. A write happens
 * when maybeFlushOnDbActivity() is called (from the Prisma extension, i.e. when
 * some other query already has a connection open) or on shutdown. The bugs
 * these lock down:
 *
 * 1. An hourly row must be stamped with the hour its samples belong to, even
 *    when the write happens in a later hour — the case the old code avoided by
 *    always writing synchronously at the boundary.
 * 2. Samples recorded while a flush is in flight must not be cleared away.
 * 3. A failed write must put each batch back under its own hour, not merge
 *    everything into whatever hour the retry lands in.
 * 4. Riding DB activity must not turn a burst of queries into a burst of
 *    writes, and must not write when there is nothing buffered.
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

/** [name, timestamp, avg, count] of one INSERT. */
function rowOf(call: unknown[]) {
  const [name, timestamp, avg, count] = callValues(call).slice(1)
  return { name, timestamp: timestamp as Date, avg: avg as number, count: count as number }
}

beforeEach(() => {
  executeRaw.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('metrics buffer', () => {
  it('writes nothing until the DB is touched or the process stops', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'))
    const { recordMetric } = await freshBuffer()

    recordMetric('db_queries_total', 1)
    // Time passing is explicitly not a trigger any more.
    vi.setSystemTime(new Date('2026-07-27T10:59:00.000Z'))
    recordMetric('db_queries_total', 1)

    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('persists when something else already has the DB open', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'))
    const { recordMetric, maybeFlushOnDbActivity } = await freshBuffer()

    recordMetric('db_queries_total', 1)
    recordMetric('db_queries_total', 1)
    maybeFlushOnDbActivity()

    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(1))
    const row = rowOf(executeRaw.mock.calls[0])
    expect(row.name).toBe('db_queries_total')
    expect(row.count).toBe(2)
  })

  it('does not write when there is nothing buffered', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'))
    const { maybeFlushOnDbActivity } = await freshBuffer()

    maybeFlushOnDbActivity()
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('does not turn a burst of queries into a burst of writes', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'))
    const { recordMetric, maybeFlushOnDbActivity } = await freshBuffer()

    recordMetric('db_queries_total', 1)
    maybeFlushOnDbActivity()
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(1))

    // Second trigger inside the minimum spacing window: ignored.
    recordMetric('db_queries_total', 1)
    vi.setSystemTime(new Date('2026-07-27T10:00:30.000Z'))
    maybeFlushOnDbActivity()

    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it('stamps a carried hour with the hour its samples belong to', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:30:00.000Z'))
    const { recordMetric, maybeFlushOnDbActivity } = await freshBuffer()

    recordMetric('db_queries_total', 1)
    recordMetric('db_queries_total', 1)

    // Cross into the next hour with no DB activity: the delta is carried, not
    // written. Only a later trigger persists it — under the OLD hour.
    vi.setSystemTime(new Date('2026-07-27T11:00:05.000Z'))
    recordMetric('db_queries_total', 1)
    expect(executeRaw).not.toHaveBeenCalled()

    maybeFlushOnDbActivity()
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(2))

    const carried = rowOf(executeRaw.mock.calls[0])
    expect(carried.timestamp.toISOString()).toBe('2026-07-27T10:00:00.000Z')
    expect(carried.count).toBe(2)

    const current = rowOf(executeRaw.mock.calls[1])
    expect(current.timestamp.toISOString()).toBe('2026-07-27T11:00:00.000Z')
    expect(current.count).toBe(1)
  })

  it('keeps samples recorded during an in-flight flush', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'))
    const { recordMetric, maybeFlushOnDbActivity, stopMetricsFlush } = await freshBuffer()

    let release: (() => void) | undefined
    executeRaw.mockImplementationOnce(
      () => new Promise<number>(resolve => { release = () => resolve(1) })
    )

    recordMetric('db_queries_total', 1)
    maybeFlushOnDbActivity()
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(1))

    // Recorded while the first write is still open.
    recordMetric('db_queries_total', 1)

    release?.()
    await stopMetricsFlush()

    const totalCount = executeRaw.mock.calls
      .map(call => rowOf(call).count)
      .reduce((a, b) => a + b, 0)
    expect(totalCount).toBe(2)
  })

  it('puts a failed write back under its own hour', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:30:00.000Z'))
    const { recordMetric, maybeFlushOnDbActivity, stopMetricsFlush } = await freshBuffer()

    executeRaw.mockRejectedValueOnce(new Error('connection lost'))

    recordMetric('db_queries_total', 1)
    maybeFlushOnDbActivity()
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(1))

    // Retry lands in the next hour; the sample must still be stamped 10:00.
    vi.setSystemTime(new Date('2026-07-27T11:05:00.000Z'))
    recordMetric('db_queries_total', 1)
    await stopMetricsFlush()

    const retried = executeRaw.mock.calls.slice(1).map(rowOf)
    const tenOClock = retried.find(r => r.timestamp.toISOString() === '2026-07-27T10:00:00.000Z')
    expect(tenOClock?.count).toBe(1)
    expect(retried.reduce((a, r) => a + r.count, 0)).toBe(2)
  })

  it('writes path hits as day-stamped rows and merges counts shipped from the proxy', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:30:00.000Z'))
    const { recordPathHit, mergeShipped, maybeFlushOnDbActivity } = await freshBuffer()

    recordPathHit('example.com/a')
    recordPathHit('example.com/a')
    // Same counters arriving from the proxy's separate module instance.
    mergeShipped({ paths: [['example.com/a', 3], ['example.com/b', 1]] })

    maybeFlushOnDbActivity()
    await vi.waitFor(() => expect(executeRaw).toHaveBeenCalledTimes(2))

    const rows = executeRaw.mock.calls.map(rowOf)
    const a = rows.find(r => r.name === 'path:example.com/a')
    const b = rows.find(r => r.name === 'path:example.com/b')
    expect(a?.count).toBe(5)
    expect(b?.count).toBe(1)
    // Day-rounded, not hour-rounded: ~500 URLs would be 12k rows a day otherwise.
    expect(a?.timestamp.toISOString()).toBe('2026-07-27T00:00:00.000Z')
  })

  it('ignores unknown metric names shipped from another runtime', async () => {
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'))
    const { mergeShipped, maybeFlushOnDbActivity } = await freshBuffer()

    mergeShipped({ metrics: [['not_a_real_metric', { sum: 5, count: 5 }]] })
    maybeFlushOnDbActivity()

    expect(executeRaw).not.toHaveBeenCalled()
  })
})
