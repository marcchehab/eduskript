/**
 * Metrics Registry - defines all known metrics with metadata.
 *
 * To add a new metric: add an entry here with unit and source.
 * The metric will automatically appear in the admin panel.
 */

export const METRICS = {
  // Server-side metrics
  db_queries_total: { unit: 'queries/min', source: 'server' as const },
  db_queries_per_request: { unit: 'count', source: 'server' as const },
  db_query_time_ms: { unit: 'ms', source: 'server' as const },
  api_response_time_ms: { unit: 'ms', source: 'server' as const },

  // Client-side metrics
  page_load_time_ms: { unit: 'ms', source: 'client' as const },
  time_to_interactive_ms: { unit: 'ms', source: 'client' as const },
  annotation_points_per_stroke: { unit: 'count', source: 'client' as const },
  editor_save_time_ms: { unit: 'ms', source: 'client' as const },
} as const

export type MetricName = keyof typeof METRICS
export type MetricSource = 'server' | 'client'

export function isValidMetricName(name: string): name is MetricName {
  return name in METRICS
}

export function isClientMetric(name: MetricName): boolean {
  return METRICS[name].source === 'client'
}

export function isServerMetric(name: MetricName): boolean {
  return METRICS[name].source === 'server'
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
