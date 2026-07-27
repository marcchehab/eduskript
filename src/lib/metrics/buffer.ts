/**
 * In-memory metrics buffer.
 *
 * Accumulates metrics per minute for the live view and flushes the pending
 * delta to the DB once a minute (and at every hour boundary). The DB stores
 * one row per metric per hour; flushes merge into that row (count summed, avg
 * re-weighted), so partial flushes, several runtimes and several deployed
 * instances all add up instead of overwriting each other.
 *
 * A restart therefore loses at most the last minute of data.
 *
 * NOTE ON PROCESS BOUNDARIES: this module is instantiated separately in each
 * Next.js bundle. `src/proxy.ts` (page_loads_total) and the app server
 * (db_* metrics, /api/metrics) each hold their own buffer, so the live view
 * served by /api/metrics only ever shows the app server's metrics. Page loads
 * are visible in history only. Same for multiple instances in production.
 */

import { type MetricName, isValidMetricName } from './registry'

interface MetricAccumulator {
  sum: number
  count: number
}

interface MinuteSnapshot {
  timestamp: Date
  metrics: Map<MetricName, { avg: number; count: number }>
}

// Current minute's accumulator per metric
const currentMinuteBuffer = new Map<MetricName, MetricAccumulator>()

// Samples recorded since the last DB flush. Not "the whole hour" — it is the
// delta that still has to be merged into the current hour's row.
const pendingDbBuffer = new Map<MetricName, MetricAccumulator>()

// Ring buffer of last 60 minutes for admin panel live view
const recentMinutes: MinuteSnapshot[] = []
const MAX_RECENT_MINUTES = 60

// Track timestamps
let currentMinuteTimestamp: number = getMinuteTimestamp(new Date())
let currentHourTimestamp: number = getHourTimestamp(new Date())

// Flush interval handle
let flushIntervalId: NodeJS.Timeout | null = null

/**
 * Round a date down to the nearest minute
 */
function getMinuteTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 60000) * 60000
}

/**
 * Round a date down to the nearest hour
 */
function getHourTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 3600000) * 3600000
}

/**
 * Record a metric value. Call this from anywhere in the app.
 */
export function recordMetric(name: MetricName, value: number): void {
  if (!isValidMetricName(name)) {
    console.warn(`[Metrics] Unknown metric: ${name}`)
    return
  }

  // Roll the buffers forward first, so this sample lands in the right minute
  // and the right hourly row.
  rollBuffers()

  // Add to minute buffer (for live view)
  const minuteAcc = currentMinuteBuffer.get(name) ?? { sum: 0, count: 0 }
  minuteAcc.sum += value
  minuteAcc.count++
  currentMinuteBuffer.set(name, minuteAcc)

  // Add to the pending DB delta
  const pendingAcc = pendingDbBuffer.get(name) ?? { sum: 0, count: 0 }
  pendingAcc.sum += value
  pendingAcc.count++
  pendingDbBuffer.set(name, pendingAcc)
}

/**
 * Advance minute/hour boundaries and flush what is due.
 *
 * Runs from recordMetric (so the proxy runtime, which has no interval timer,
 * still flushes while traffic exists) and from the interval timer.
 */
function rollBuffers(): void {
  const now = new Date()
  const nowMinute = getMinuteTimestamp(now)
  const nowHour = getHourTimestamp(now)

  if (nowHour !== currentHourTimestamp) {
    // Drains synchronously against the OLD hour timestamp; only the DB write
    // is async. Reassigning right after is therefore safe.
    void flushPendingToDb()
    currentHourTimestamp = nowHour
  }

  if (nowMinute !== currentMinuteTimestamp) {
    flushMinuteToRingBuffer()
    currentMinuteTimestamp = nowMinute
    // Cap data loss on restart at roughly one minute.
    void flushPendingToDb()
  }
}

/**
 * Flush current minute to ring buffer (for live view)
 */
function flushMinuteToRingBuffer(): void {
  if (currentMinuteBuffer.size === 0) return

  const snapshot: MinuteSnapshot = {
    timestamp: new Date(currentMinuteTimestamp),
    metrics: new Map(),
  }

  for (const [name, acc] of currentMinuteBuffer) {
    snapshot.metrics.set(name, {
      avg: acc.count > 0 ? acc.sum / acc.count : 0,
      count: acc.count,
    })
  }

  recentMinutes.push(snapshot)
  if (recentMinutes.length > MAX_RECENT_MINUTES) {
    recentMinutes.shift()
  }

  currentMinuteBuffer.clear()
}

/**
 * Merge the pending delta into the current hour's DB rows.
 *
 * The buffer is drained synchronously before the first `await`, so callers may
 * advance `currentHourTimestamp` immediately after the call and samples
 * recorded during the write land in the next delta instead of being dropped.
 *
 * Writes go through `prismaBase` (the unextended client) on purpose: the
 * extended client records db_queries_total/db_query_time_ms, so flushing via
 * it would count its own writes.
 *
 * Uses dynamic import to avoid pulling Prisma into the Edge Runtime.
 */
async function flushPendingToDb(): Promise<void> {
  if (pendingDbBuffer.size === 0) return

  // Synchronous drain — nothing awaited above this point.
  const timestamp = new Date(currentHourTimestamp)
  const entries = Array.from(pendingDbBuffer.entries())
  pendingDbBuffer.clear()

  try {
    const { prismaBase } = await import('@/lib/prisma')

    for (const [name, acc] of entries) {
      const avg = acc.count > 0 ? acc.sum / acc.count : 0

      // Weighted merge in SQL so concurrent writers (proxy runtime, app
      // server, several instances) accumulate instead of clobbering.
      await prismaBase.$executeRaw`
        INSERT INTO metric_points (id, name, timestamp, avg, count, created_at)
        VALUES (${globalThis.crypto.randomUUID()}, ${name}, ${timestamp}, ${avg}, ${acc.count}, NOW())
        ON CONFLICT (name, timestamp) DO UPDATE SET
          avg = (metric_points.avg * metric_points.count + EXCLUDED.avg * EXCLUDED.count)
                / NULLIF(metric_points.count + EXCLUDED.count, 0),
          count = metric_points.count + EXCLUDED.count
      `
    }
  } catch (error) {
    // Put the delta back so the next flush retries it, merged with anything
    // recorded meanwhile. Caveat: the retry is stamped with whatever hour is
    // current then, so a write that fails across an hour boundary lands in the
    // wrong hour. Totals stay correct; the hourly split does not.
    for (const [name, acc] of entries) {
      const existing = pendingDbBuffer.get(name) ?? { sum: 0, count: 0 }
      existing.sum += acc.sum
      existing.count += acc.count
      pendingDbBuffer.set(name, existing)
    }
    console.error('[Metrics] Failed to flush to DB:', error)
  }
}

/**
 * Get recent in-memory minutes for admin panel live view
 */
export function getRecentMinutes(): Array<{
  timestamp: Date
  data: Record<string, { avg: number; count: number }>
}> {
  // Include current minute buffer as the latest
  const result = recentMinutes.map(snapshot => ({
    timestamp: snapshot.timestamp,
    data: Object.fromEntries(snapshot.metrics),
  }))

  // Add current minute if it has data
  if (currentMinuteBuffer.size > 0) {
    const currentData: Record<string, { avg: number; count: number }> = {}
    for (const [name, acc] of currentMinuteBuffer) {
      currentData[name] = {
        avg: acc.count > 0 ? acc.sum / acc.count : 0,
        count: acc.count,
      }
    }
    result.push({
      timestamp: new Date(currentMinuteTimestamp),
      data: currentData,
    })
  }

  return result
}

/**
 * Start the flush interval (call once on server startup)
 */
export function startMetricsFlush(): void {
  if (flushIntervalId) return

  // Check every 10 seconds for minute/hour changes
  flushIntervalId = setInterval(rollBuffers, 10000)

  // Don't prevent Node from exiting
  flushIntervalId.unref()

  console.log('[Metrics] Flush interval started')
}

/**
 * Stop the flush interval and flush remaining data
 */
export async function stopMetricsFlush(): Promise<void> {
  if (flushIntervalId) {
    clearInterval(flushIntervalId)
    flushIntervalId = null
  }
  flushMinuteToRingBuffer()
  await flushPendingToDb()
}

/**
 * Get all metric names that have data (for admin panel)
 */
export function getActiveMetricNames(): MetricName[] {
  const names = new Set<MetricName>()

  for (const name of currentMinuteBuffer.keys()) {
    names.add(name)
  }

  for (const name of pendingDbBuffer.keys()) {
    names.add(name)
  }

  for (const minute of recentMinutes) {
    for (const name of minute.metrics.keys()) {
      names.add(name)
    }
  }

  return Array.from(names)
}
