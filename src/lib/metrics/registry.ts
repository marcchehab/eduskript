/**
 * Metrics Registry - defines all known metrics with metadata.
 *
 * To add a new metric: add an entry here with unit and source.
 * The metric will automatically appear in the admin panel.
 */

export const METRICS = {
  // Server-side metrics (active)
  page_loads_total: { unit: 'loads', source: 'server' as const, display: 'count' as const },
  db_queries_total: { unit: 'queries', source: 'server' as const, display: 'count' as const },
  db_query_time_ms: { unit: 'ms', source: 'server' as const, display: 'avg' as const },
} as const

/**
 * Calculated metrics derived from raw metrics.
 * These are computed on the dashboard, not stored in DB.
 */
export const CALCULATED_METRICS = {
  db_queries_per_page_load: {
    label: 'DB Queries per Page Load',
    unit: 'queries/load',
    formula: (data: { db_queries_total?: number; page_loads_total?: number }) => {
      const queries = data.db_queries_total ?? 0
      const loads = data.page_loads_total ?? 0
      return loads > 0 ? queries / loads : 0
    },
    description: 'Average database queries triggered per page navigation',
  },
} as const

export type CalculatedMetricName = keyof typeof CALCULATED_METRICS

export type MetricName = keyof typeof METRICS
export type MetricSource = 'server' | 'client'
export type MetricDisplay = 'avg' | 'count'

export function isValidMetricName(name: string): name is MetricName {
  return name in METRICS
}

/**
 * Format metric name for display: "db_queries_per_request" -> "DB Queries Per Request"
 */
export function formatMetricName(name: string): string {
  return name
    .split('_')
    .map(word => {
      // Keep common abbreviations uppercase
      if (['db', 'api', 'ms'].includes(word.toLowerCase())) {
        return word.toUpperCase()
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * Get unit for a metric
 */
export function getMetricUnit(name: MetricName): string {
  return METRICS[name].unit
}

/**
 * Get display mode for a metric (avg or count)
 */
export function getMetricDisplay(name: MetricName): MetricDisplay {
  return METRICS[name].display
}
