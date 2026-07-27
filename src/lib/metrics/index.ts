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
 * per hour, flushed every minute. See buffer.ts for the process-boundary
 * caveat (page_loads_total is recorded in the proxy bundle, so it never shows
 * in the live view).
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
