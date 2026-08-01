/**
 * Metrics System
 *
 * A lightweight metrics system for tracking site-wide statistics.
 *
 * Active metrics:
 * - page_loads_total: Browser navigations (via Sec-Fetch-Mode header)
 * - db_queries_total: Total database queries
 * - db_query_time_ms: Average query duration
 *
 * Calculated metrics (derived on dashboard):
 * - db_queries_per_page_load: queries / page loads
 *
 * Add new metrics by updating registry.ts
 *
 * Storage: samples accumulate in memory and merge into one DB row per metric
 * per hour. Writes are opportunistic — they happen when some other query
 * already has a DB connection open, or at shutdown, never on a timer. The
 * managed Postgres bills awake-time, so a timed flush was itself what kept it
 * from sleeping. See buffer.ts.
 *
 * The proxy bundle has its own module instance and no Prisma, so it ships its
 * counters to the app runtime via /api/internal/metrics-ingest. That is also
 * why page_loads_total never shows in the live view.
 *
 * Request counts per URL ride the same table under a `path:` name (day-rounded)
 * and feed the boot-time cache warmer in src/lib/cache-warmer.ts.
 */

export { recordMetric, getRecentMinutes, startMetricsFlush, stopMetricsFlush, getActiveMetricNames } from './buffer'
export {
  METRICS,
  CALCULATED_METRICS,
  type MetricName,
  isValidMetricName,
  formatMetricName,
  getMetricUnit,
} from './registry'
export {
  cleanupOldMetrics,
  getAggregatedMetrics,
  getMetricTimeSeries,
  getMetricDailyAggregates,
  runAggregationTasks,
} from './aggregation'
