/**
 * In-memory metrics buffer.
 *
 * Accumulates metrics per minute for the live view and flushes the pending
 * delta to the DB every DB_FLUSH_INTERVAL_MS (and at every hour boundary). The
 * DB stores one row per metric per hour; flushes merge into that row (count
 * summed, avg re-weighted), so partial flushes, several runtimes and several
 * deployed instances all add up instead of overwriting each other.
 *
 * An unclean restart loses at most one flush interval; SIGTERM/SIGINT flush
 * first (src/instrumentation.ts), best-effort.
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

// Deltas for hours that have already ended but were never written, because no
// DB connection happened to be open when they closed. Each carries its own
// hour timestamp so it still merges into the right row whenever it does get
// flushed — the reason the old code had to write synchronously at the hour
// boundary.
const carriedHours: Array<{ timestamp: number; entries: Map<MetricName, MetricAccumulator> }> = []
const MAX_CARRIED_HOURS = 48

// Request counts per public path, used to pick what the boot-time cache warmer
// renders (src/lib/cache-warmer.ts). Stored in metric_points under a `path:`
// name so it needs no table of its own, but rounded to the DAY rather than the
// hour: ~500 public URLs would otherwise add ~12k rows a day, and the warmer
// only ever reads a 7-day sum.
const pendingPathHits = new Map<string, number>()
export const PATH_METRIC_PREFIX = 'path:'
// Bounds the memory a hostile crawler can make us hold by requesting junk URLs.
const MAX_TRACKED_PATHS = 2000

// Which minutes of which hour saw a DB query, as a 60-bit mask per hour. Read
// by the awake-time report (src/lib/metrics/db-awake.ts); see the DbActivityHour
// model for why the resolution is stored rather than a precomputed total.
//
// Keyed by hour timestamp so an hour that ends before any flush still lands in
// its own row, the same carry trick pendingDbBuffer needs.
const pendingActiveMinutes = new Map<number, bigint>()
// Two days of unflushed hours means the DB has been unreachable that long.
const MAX_PENDING_ACTIVITY_HOURS = 48

// Ring buffer of last 60 minutes for admin panel live view
const recentMinutes: MinuteSnapshot[] = []
const MAX_RECENT_MINUTES = 60

// Track timestamps
let currentMinuteTimestamp: number = getMinuteTimestamp(new Date())
let currentHourTimestamp: number = getHourTimestamp(new Date())

// Persistence is opportunistic: the delta is written only when something else
// has already opened a DB connection (see maybeFlushOnDbActivity, called from
// the Prisma extension in src/lib/prisma.ts) or on shutdown. The managed
// Postgres sleeps after 5 minutes without a connection and bills compute while
// awake, so a timer-driven flush was itself the thing keeping it awake — six
// wakes an hour to store a handful of counters nobody was reading. Riding an
// existing connection costs nothing.
//
// Consequence: with no DB traffic at all, nothing is persisted until SIGTERM,
// and a hard kill (OOM, crash) loses the window. Acceptable for metrics.
//
// A minimum spacing still applies so a burst of queries does not turn into a
// burst of writes.
const MIN_FLUSH_SPACING_MS = 60 * 1000
let lastDbFlushAt = 0

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
 * Count one request for `path`.
 *
 * Called from the proxy, which is the only place that sees every request —
 * an ISR cache hit never reaches the page component. Cheap and synchronous;
 * persistence happens on the usual opportunistic triggers.
 */
export function recordPathHit(path: string): void {
  if (pendingPathHits.size >= MAX_TRACKED_PATHS && !pendingPathHits.has(path)) return
  pendingPathHits.set(path, (pendingPathHits.get(path) ?? 0) + 1)
}

/**
 * Mark the current minute as one in which the database was queried.
 *
 * Called from the Prisma extension alongside the query counters. Deliberately
 * separate from recordMetric: the counters answer "how much", this answers
 * "when", and only the latter can reconstruct awake-time, because the instance
 * suspends on a gap rather than on a volume.
 *
 * O(1) and allocation-free in the common case — the hour's mask already exists
 * and the bit is already set.
 */
export function recordDbActivity(): void {
  const now = Date.now()
  const hour = Math.floor(now / 3600000) * 3600000
  const minuteOfHour = Math.floor((now - hour) / 60000)
  const bit = 1n << BigInt(minuteOfHour)

  const mask = pendingActiveMinutes.get(hour) ?? 0n
  if (mask & bit) return
  pendingActiveMinutes.set(hour, mask | bit)

  while (pendingActiveMinutes.size > MAX_PENDING_ACTIVITY_HOURS) {
    const oldest = pendingActiveMinutes.keys().next().value
    if (oldest === undefined) break
    pendingActiveMinutes.delete(oldest)
  }
}

/** Snapshot and clear the local buffers, for shipping to another runtime. */
export function drainForShipping(): { metrics: Array<[string, MetricAccumulator]>; paths: Array<[string, number]> } {
  const metrics = Array.from(pendingDbBuffer.entries())
  const paths = Array.from(pendingPathHits.entries())
  pendingDbBuffer.clear()
  pendingPathHits.clear()
  return { metrics, paths }
}

/**
 * Merge counts recorded in another Next.js bundle into this one.
 *
 * The proxy runs as a separate module instance with its own buffers and never
 * touches Prisma, so it has no DB connection to ride and would only ever
 * persist at shutdown. It ships its buffer here instead (see
 * /api/internal/metrics-ingest), and this runtime writes it out on the next
 * query that happens anyway.
 */
export function mergeShipped(payload: {
  metrics?: Array<[string, MetricAccumulator]>
  paths?: Array<[string, number]>
}): void {
  for (const [name, acc] of payload.metrics ?? []) {
    if (!isValidMetricName(name)) continue
    const existing = pendingDbBuffer.get(name) ?? { sum: 0, count: 0 }
    existing.sum += acc.sum
    existing.count += acc.count
    pendingDbBuffer.set(name, existing)
  }
  for (const [path, hits] of payload.paths ?? []) {
    if (pendingPathHits.size >= MAX_TRACKED_PATHS && !pendingPathHits.has(path)) continue
    pendingPathHits.set(path, (pendingPathHits.get(path) ?? 0) + hits)
  }
}

/**
 * Advance minute/hour boundaries and roll the live-view ring buffer.
 *
 * Runs from recordMetric and from the 10s interval timer. DB writes are NOT
 * driven from here any more — see maybeFlushOnDbActivity.
 */
function rollBuffers(): void {
  const now = new Date()
  const nowMinute = getMinuteTimestamp(now)
  const nowHour = getHourTimestamp(now)

  if (nowHour !== currentHourTimestamp) {
    // Crossing an hour is the one case where the pending delta MUST be drained
    // synchronously against the old hour, or its samples would be merged into
    // the wrong hourly row. The write itself still only happens if the DB is
    // reachable; if it fails the delta is put back (see flushPendingToDb) and
    // lands in the wrong hour — totals stay correct, the split does not.
    drainToCarry()
    currentHourTimestamp = nowHour
  }

  if (nowMinute !== currentMinuteTimestamp) {
    flushMinuteToRingBuffer()
    currentMinuteTimestamp = nowMinute
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
 * Move the current delta into the carry list, stamped with the hour it belongs
 * to. Called when the hour rolls over, so a later flush still merges the
 * samples into the right row instead of the hour it happens to run in.
 */
function drainToCarry(): void {
  if (pendingDbBuffer.size === 0) return
  carriedHours.push({ timestamp: currentHourTimestamp, entries: new Map(pendingDbBuffer) })
  pendingDbBuffer.clear()
  // Two days of unwritten hours means the DB has been unreachable that long;
  // dropping the oldest keeps a stuck instance from growing without bound.
  while (carriedHours.length > MAX_CARRIED_HOURS) carriedHours.shift()
}

/**
 * Write everything outstanding: carried hours first, then the current delta.
 *
 * Both buffers are drained synchronously before the first `await`, so samples
 * recorded during the write land in the next delta instead of being dropped.
 *
 * Writes go through `prismaBase` (the unextended client) on purpose: the
 * extended client records db_queries_total/db_query_time_ms, so flushing via it
 * would count its own writes — and, now that the flush is triggered from that
 * same extension, would recurse.
 *
 * Uses dynamic import to avoid pulling Prisma into the Edge Runtime.
 */
async function flushPendingToDb(): Promise<void> {
  const batches: Array<{ timestamp: number; entries: Array<[MetricName, MetricAccumulator]> }> = []

  for (const carried of carriedHours.splice(0)) {
    batches.push({ timestamp: carried.timestamp, entries: Array.from(carried.entries) })
  }
  if (pendingDbBuffer.size > 0) {
    batches.push({ timestamp: currentHourTimestamp, entries: Array.from(pendingDbBuffer) })
    pendingDbBuffer.clear()
  }

  // Path counts share the table but are stamped to the day (see the comment on
  // pendingPathHits). `avg` is meaningless for them; only `count` is read.
  const pathEntries = Array.from(pendingPathHits.entries())
  pendingPathHits.clear()
  const dayTimestamp = new Date(Math.floor(Date.now() / 86400000) * 86400000)

  const activityEntries = Array.from(pendingActiveMinutes.entries())
  pendingActiveMinutes.clear()

  if (batches.length === 0 && pathEntries.length === 0 && activityEntries.length === 0) return

  lastDbFlushAt = Date.now()

  try {
    const { prismaBase } = await import('@/lib/prisma')

    for (const batch of batches) {
      const timestamp = new Date(batch.timestamp)
      for (const [name, acc] of batch.entries) {
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
    }
    for (const [path, hits] of pathEntries) {
      await prismaBase.$executeRaw`
        INSERT INTO metric_points (id, name, timestamp, avg, count, created_at)
        VALUES (${globalThis.crypto.randomUUID()}, ${PATH_METRIC_PREFIX + path}, ${dayTimestamp}, ${0}, ${hits}, NOW())
        ON CONFLICT (name, timestamp) DO UPDATE SET
          count = metric_points.count + EXCLUDED.count
      `
    }
    for (const [hour, mask] of activityEntries) {
      // Bitwise OR, not addition: two instances active in the same minute must
      // union to one active minute, or the awake-time would exceed wall-clock.
      await prismaBase.$executeRaw`
        INSERT INTO db_activity_hours (hour, minutes, updated_at)
        VALUES (${new Date(hour)}, ${mask}, NOW())
        ON CONFLICT (hour) DO UPDATE SET
          minutes = db_activity_hours.minutes | EXCLUDED.minutes,
          updated_at = NOW()
      `
    }
  } catch (error) {
    // Put every batch back with its own hour intact, so a failed write no
    // longer corrupts the hourly split the way the old single-buffer retry did.
    for (const batch of batches) {
      if (batch.timestamp === currentHourTimestamp) {
        for (const [name, acc] of batch.entries) {
          const existing = pendingDbBuffer.get(name) ?? { sum: 0, count: 0 }
          existing.sum += acc.sum
          existing.count += acc.count
          pendingDbBuffer.set(name, existing)
        }
      } else {
        carriedHours.unshift({ timestamp: batch.timestamp, entries: new Map(batch.entries) })
      }
    }
    while (carriedHours.length > MAX_CARRIED_HOURS) carriedHours.shift()
    for (const [path, hits] of pathEntries) {
      pendingPathHits.set(path, (pendingPathHits.get(path) ?? 0) + hits)
    }
    for (const [hour, mask] of activityEntries) {
      pendingActiveMinutes.set(hour, (pendingActiveMinutes.get(hour) ?? 0n) | mask)
    }
    while (pendingActiveMinutes.size > MAX_PENDING_ACTIVITY_HOURS) {
      const oldest = pendingActiveMinutes.keys().next().value
      if (oldest === undefined) break
      pendingActiveMinutes.delete(oldest)
    }
    console.error('[Metrics] Failed to flush to DB:', error)
  }
}

/**
 * Persist if something else already has the DB open.
 *
 * Called from the Prisma extension on every query through the extended client
 * (src/lib/prisma.ts). The connection is already established at that point, so
 * the write rides it instead of waking the instance on its own — which is the
 * whole point: a timer-driven flush was itself holding the database awake.
 *
 * Fire-and-forget and never awaited by the caller, so a slow write cannot add
 * latency to the query that triggered it. Re-entrancy is guarded by
 * `flushInFlight`; `MIN_FLUSH_SPACING_MS` keeps a burst of queries from turning
 * into a burst of writes.
 */
let flushInFlight = false

export function maybeFlushOnDbActivity(): void {
  if (flushInFlight) return
  if (
    pendingDbBuffer.size === 0 &&
    carriedHours.length === 0 &&
    pendingPathHits.size === 0 &&
    pendingActiveMinutes.size === 0
  ) return
  if (Date.now() - lastDbFlushAt < MIN_FLUSH_SPACING_MS) return

  flushInFlight = true
  void flushPendingToDb().finally(() => {
    flushInFlight = false
  })
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
 * Start the roll-over timer (call once on server startup).
 *
 * Only advances the minute/hour buffers for the live view — it no longer
 * writes to the DB; see maybeFlushOnDbActivity.
 */
export function startMetricsFlush(): void {
  if (flushIntervalId) return

  // Check every 10 seconds for minute/hour changes
  flushIntervalId = setInterval(rollBuffers, 10000)

  // Don't prevent Node from exiting
  flushIntervalId.unref()

  console.log('[Metrics] Roll-over interval started')
}

/**
 * Stop the timer and write whatever is outstanding.
 *
 * The shutdown path is the one flush that does not wait for a DB connection to
 * already exist: it is the last chance to persist the window, and the instance
 * is going away anyway.
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
