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
