/**
 * In-memory metrics buffer.
 *
 * Accumulates metrics per minute for live view, flushes to DB hourly.
 * DB stores one row per metric per hour (normalized schema).
 *
 * NOTE: In dev mode with multiple workers (Turbopack), live data may not
 * appear because middleware and API routes run in separate processes with
 * separate memory. In production single-process mode, live data works correctly.
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

// Current hour's accumulator per metric (for DB flush)
const currentHourBuffer = new Map<MetricName, MetricAccumulator>()

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

  const now = new Date()
  const nowMinute = getMinuteTimestamp(now)
  const nowHour = getHourTimestamp(now)

  // Check if we've moved to a new minute
  if (nowMinute !== currentMinuteTimestamp) {
    flushMinuteToRingBuffer()
    currentMinuteTimestamp = nowMinute
  }

  // Check if we've moved to a new hour
  if (nowHour !== currentHourTimestamp) {
    flushHourToDb()
    currentHourTimestamp = nowHour
  }

  // Add to minute buffer (for live view)
  const minuteAcc = currentMinuteBuffer.get(name) ?? { sum: 0, count: 0 }
  minuteAcc.sum += value
  minuteAcc.count++
  currentMinuteBuffer.set(name, minuteAcc)

  // Add to hour buffer (for DB)
  const hourAcc = currentHourBuffer.get(name) ?? { sum: 0, count: 0 }
  hourAcc.sum += value
  hourAcc.count++
  currentHourBuffer.set(name, hourAcc)
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
 * Flush current hour's buffer to DB
 * Uses dynamic import to avoid pulling Prisma into Edge Runtime
 */
async function flushHourToDb(): Promise<void> {
  if (currentHourBuffer.size === 0) return

  // Dynamic import - only runs in Node.js context (not Edge)
  const { prisma } = await import('@/lib/prisma')

  const timestamp = new Date(currentHourTimestamp)
  const promises: Promise<unknown>[] = []

  for (const [name, acc] of currentHourBuffer) {
    const avg = acc.count > 0 ? acc.sum / acc.count : 0

    promises.push(
      prisma.metricPoint.upsert({
        where: {
          name_timestamp: { name, timestamp },
        },
        create: {
          name,
          timestamp,
          avg,
          count: acc.count,
        },
        update: {
          // Weighted merge if somehow called twice for same hour
          avg,
          count: acc.count,
        },
      })
    )
  }

  try {
    await Promise.all(promises)
    console.log(`[Metrics] Flushed ${promises.length} metrics to DB for ${timestamp.toISOString()}`)
  } catch (error) {
    console.error('[Metrics] Failed to flush to DB:', error)
  }

  currentHourBuffer.clear()
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
  flushIntervalId = setInterval(() => {
    const now = new Date()
    const nowMinute = getMinuteTimestamp(now)
    const nowHour = getHourTimestamp(now)

    if (nowMinute !== currentMinuteTimestamp) {
      flushMinuteToRingBuffer()
      currentMinuteTimestamp = nowMinute
    }

    if (nowHour !== currentHourTimestamp) {
      flushHourToDb()
      currentHourTimestamp = nowHour
    }
  }, 10000)

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
  await flushHourToDb()
}

/**
 * Get all metric names that have data (for admin panel)
 */
export function getActiveMetricNames(): MetricName[] {
  const names = new Set<MetricName>()

  for (const name of currentMinuteBuffer.keys()) {
    names.add(name)
  }

  for (const name of currentHourBuffer.keys()) {
    names.add(name)
  }

  for (const minute of recentMinutes) {
    for (const name of minute.metrics.keys()) {
      names.add(name)
    }
  }

  return Array.from(names)
}
