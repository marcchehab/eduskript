'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, TrendingUp, Clock, Database, ChevronDown, ChevronRight } from 'lucide-react'
import { formatMetricName, getMetricUnit, getMetricDisplay, METRICS, CALCULATED_METRICS, type MetricName } from '@/lib/metrics/registry'
import { DbAwakeCard } from '@/components/dashboard/db-awake-card'
import { MetricsHoverProvider, useMetricsHover, findNearestBucket, formatHoverTime } from '@/components/dashboard/metrics-hover-context'

interface MetricData {
  avg: number
  count: number
}

interface LiveMinute {
  timestamp: string
  data: Record<string, MetricData>
}

interface HistoryResponse {
  days: number
  metrics: Record<string, Array<{ timestamp: string; avg: number; count: number }>>
}

interface LiveResponse {
  minutes: LiveMinute[]
}

export default function MetricsAdminPage() {
  const { data: session } = useSession()
  const router = useRouter()

  const [liveData, setLiveData] = useState<LiveMinute[]>([])
  const [historyData, setHistoryData] = useState<Record<string, Array<{ timestamp: string; avg: number; count: number }>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedMetric, setSelectedMetric] = useState<MetricName | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  // The raw per-minute table is rarely what an admin needs at a glance — the
  // cards above already reflect it within a minute — so it starts collapsed.
  const [liveDataOpen, setLiveDataOpen] = useState(false)

  // Check admin access
  useEffect(() => {
    if (session && !session.user.isAdmin) {
      router.push('/dashboard')
    }
  }, [session, router])

  // Fetch live data (in-memory)
  const fetchLiveData = useCallback(async () => {
    try {
      const response = await fetch('/api/metrics')
      if (!response.ok) throw new Error('Failed to fetch live metrics')
      const data: LiveResponse = await response.json()
      setLiveData(data.minutes)
    } catch (err) {
      console.error('Failed to fetch live data:', err)
    }
  }, [])

  // Fetch historical data
  const fetchHistoryData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/metrics/history?days=7')
      if (!response.ok) throw new Error('Failed to fetch historical metrics')
      const data: HistoryResponse = await response.json()
      setHistoryData(data.metrics)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    if (session?.user?.isAdmin) {
      fetchLiveData()
      fetchHistoryData()
    }
  }, [session, fetchLiveData, fetchHistoryData])

  // Auto-refresh live data
  useEffect(() => {
    if (!autoRefresh || !session?.user?.isAdmin) return

    const interval = setInterval(fetchLiveData, 10000) // Every 10 seconds
    return () => clearInterval(interval)
  }, [autoRefresh, session, fetchLiveData])

  // Only show metrics defined in registry (not auto-discovered)
  const allMetricNames = Object.keys(METRICS) as MetricName[]

  // Metrics recorded in this process, i.e. the only ones /api/metrics can
  // return from memory.
  const liveMetricNames = allMetricNames.filter(name => METRICS[name].live)

  // Totals feeding the calculated metrics. History only — the in-memory ring
  // buffer overlaps hours that are already flushed to the DB, so adding it
  // would double-count, and page loads are not in this process's memory at all.
  const getTotals = () => {
    const totals: Record<string, number> = {}
    for (const name of allMetricNames) {
      if ((METRICS[name]?.display || 'avg') === 'count') {
        totals[name] = getHistorySummary(name)?.count ?? 0
      }
    }
    return totals
  }

  // Per-hour "db queries per page load" — a direct derivation of the two
  // count metrics above, not a separate stored series. Aligned by timestamp
  // rather than array index: db_queries_total and page_loads_total are
  // flushed from different processes (proxy vs. app server), so an hour
  // missing in one doesn't necessarily line up positionally with the other.
  const getDbQueriesPerLoadSeries = () => {
    const queries = historyData['db_queries_total'] || []
    const loads = historyData['page_loads_total'] || []
    const loadsByHour = new Map(loads.map(p => [p.timestamp, p.count]))
    const timestamps: string[] = []
    const values: number[] = []
    for (const p of queries) {
      const load = loadsByHour.get(p.timestamp)
      if (!load) continue
      timestamps.push(p.timestamp)
      values.push(p.count / load)
    }
    return { timestamps, values }
  }

  // Hours the deploy-time cache warmer was active — shaded onto the
  // db_queries_total and db_queries_per_page_load charts (see MetricChart's
  // highlightTimestamps) so a spike caused by the warmer is visible in the
  // chart itself instead of requiring a side-by-side comparison.
  const warmerHours = new Set((historyData['warmer_requests_total'] || []).map(p => p.timestamp))

  // Calculate summary stats for a metric from history data
  const getHistorySummary = (metricName: MetricName) => {
    const points = historyData[metricName]
    if (!points || points.length === 0) return null

    const values = points.map(p => p.avg)
    const totalCount = points.reduce((sum, p) => sum + p.count, 0)
    const weightedAvg = points.reduce((sum, p) => sum + p.avg * p.count, 0) / totalCount

    return {
      current: values[values.length - 1],
      avg: weightedAvg,
      min: Math.min(...values),
      max: Math.max(...values),
      count: totalCount,
    }
  }

  // The chart is the headline of each tile now, not a plain total — a red
  // dashed line marks the average of whatever series is plotted (per-hour
  // count for count metrics, weighted avg for avg metrics) so individual
  // hours can be judged against it at a glance instead of comparing bare sums.
  //
  // Hovering sets the shared hoveredTime (src/components/dashboard/metrics-
  // hover-context.tsx); the crosshair below is drawn from that shared value,
  // not local hover state, so it mirrors across every chart on the page —
  // including DbAwakeCard, a separate component reading the same context.
  const MetricChart = ({
    data,
    timestamps,
    height = 60,
    highlightTimestamps,
  }: {
    data: number[]
    timestamps: string[]
    height?: number
    /** Hours to shade behind the line — currently used to mark deploy-time
     *  cache-warmer activity, so a spike caused by the warmer is visually
     *  obvious in the chart itself rather than requiring a side-by-side
     *  comparison with the Warmer Requests Total card. */
    highlightTimestamps?: Set<string>
  }) => {
    const { hoveredTime, setHoveredTime } = useMetricsHover()

    if (data.length === 0) {
      return (
        <div className="text-muted-foreground text-sm flex items-center justify-center h-full">
          No data
        </div>
      )
    }

    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min || 1
    const avg = data.reduce((sum, v) => sum + v, 0) / data.length
    const avgY = height - ((avg - min) / range) * height

    const step = 100 / (data.length - 1 || 1)
    const halfStep = step / 2
    const highlightIndices = highlightTimestamps
      ? timestamps.flatMap((ts, i) => (highlightTimestamps.has(ts) ? [i] : []))
      : []

    const points = data
      .map((value, i) => {
        const x = (i / (data.length - 1 || 1)) * 100
        const y = height - ((value - min) / range) * height
        return `${x},${y}`
      })
      .join(' ')

    const hoverIndex = hoveredTime !== null ? findNearestBucket(timestamps, hoveredTime) : null
    const hoverX = hoverIndex !== null ? (hoverIndex / (data.length - 1 || 1)) * 100 : null

    const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const index = Math.round(fraction * (timestamps.length - 1))
      const ts = timestamps[index]
      if (ts) setHoveredTime(new Date(ts).getTime())
    }

    return (
      <div
        className="relative h-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoveredTime(null)}
      >
        <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="overflow-visible">
          {highlightIndices.map(i => (
            <rect
              key={i}
              x={Math.max(0, i / (data.length - 1 || 1) * 100 - halfStep)}
              width={halfStep * 2}
              y={0}
              height={height}
              className="fill-amber-500/15"
            />
          ))}
          <line
            x1="0"
            x2="100"
            y1={avgY}
            y2={avgY}
            stroke="#ef4444"
            strokeWidth={1}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
          {hoverX !== null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={0}
              y2={height}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              className="text-muted-foreground/60"
            />
          )}
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            className="text-primary"
          />
        </svg>
        <span
          className="absolute right-0 text-[10px] font-medium text-red-500 bg-background/90 px-1 rounded-sm leading-none py-0.5"
          style={{ top: `${Math.min(Math.max(avgY - 7, 0), height - 14)}px` }}
        >
          avg {avg.toFixed(1)}
        </span>
        {hoverX !== null && hoveredTime !== null && (
          <span
            className="absolute text-[10px] font-medium text-muted-foreground bg-background/90 px-1 rounded-sm leading-none py-0.5 pointer-events-none whitespace-nowrap"
            style={{
              left: `${hoverX}%`,
              top: 0,
              transform: `translateX(${hoverX < 15 ? '0%' : hoverX > 85 ? '-100%' : '-50%'})`,
            }}
          >
            {formatHoverTime(hoveredTime)}
          </span>
        )}
      </div>
    )
  }

  if (!session?.user?.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Access denied. Admin privileges required.</p>
      </div>
    )
  }

  return (
    <MetricsHoverProvider>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Metrics Dashboard</h1>
          <p className="text-muted-foreground">Monitor system performance and usage statistics</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { fetchLiveData(); fetchHistoryData(); }}>
            Refresh Now
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Awake time first: it is the only number on this page that maps to a
          bill, and it answers a question the query counters cannot. */}
      <DbAwakeCard />

      {/* Metric Cards Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allMetricNames.map(name => {
          // Everything on this card comes from the hourly history so the
          // numbers are comparable across metrics — page loads live in a
          // different process and are never in this one's memory.
          const summary = getHistorySummary(name)
          const displayMode = METRICS[name as MetricName]?.display || 'avg'
          const isCountMetric = displayMode === 'count'

          const points = historyData[name] || []
          const chartData = points.map(p => isCountMetric ? p.count : p.avg)
          const chartTimestamps = points.map(p => p.timestamp)

          return (
            <Card
              key={name}
              className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${
                selectedMetric === name ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => setSelectedMetric(selectedMetric === name ? null : name)}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-medium text-sm">{formatMetricName(name)}</h3>
                  <p className="text-xs text-muted-foreground">
                    {isCountMetric ? 'per hour' : getMetricUnit(name as MetricName)}
                  </p>
                </div>
                {METRICS[name as MetricName]?.source === 'server' ? (
                  <Database className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {summary ? (
                <>
                  <div className="h-36 mb-2">
                    <MetricChart
                      data={chartData}
                      timestamps={chartTimestamps}
                      height={144}
                      highlightTimestamps={name === 'db_queries_total' ? warmerHours : undefined}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    {isCountMetric ? (
                      <span>Total (7d): {summary.count}</span>
                    ) : (
                      <>
                        <span>Min: {summary.min.toFixed(1)}</span>
                        <span>Max: {summary.max.toFixed(1)}</span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground text-sm py-4">No data yet</div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Calculated Metrics */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          Calculated Metrics <span className="text-sm font-normal text-muted-foreground">(last 7 days)</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(CALCULATED_METRICS).map(([key, metric]) => {
            // db_queries_per_page_load derives from the same two count
            // metrics above, hour by hour — a chart, not a single scalar.
            // Any future calculated metric without a matching series falls
            // back to the plain-number card below.
            const series = key === 'db_queries_per_page_load' ? getDbQueriesPerLoadSeries() : null

            if (series) {
              const { timestamps, values } = series
              const avg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
              return (
                <Card key={key} className="p-4 bg-muted/30">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium text-sm">{metric.label}</h3>
                      <p className="text-xs text-muted-foreground">{metric.unit}, per hour</p>
                    </div>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {values.length > 0 ? (
                    <div className="h-36 mb-2">
                      <MetricChart data={values} timestamps={timestamps} height={144} highlightTimestamps={warmerHours} />
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-sm py-4">No data yet</div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {metric.description} · avg {avg.toFixed(1)} {metric.unit}
                  </p>
                </Card>
              )
            }

            const totals = getTotals()
            const value = metric.formula(totals)

            return (
              <Card key={key} className="p-4 bg-muted/30">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-medium text-sm">{metric.label}</h3>
                    <p className="text-xs text-muted-foreground">{metric.unit}</p>
                  </div>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold mb-2">
                  {value.toFixed(1)}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    {metric.unit}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{metric.description}</p>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Detailed View for Selected Metric */}
      {selectedMetric && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">{formatMetricName(selectedMetric)}</h2>
              <p className="text-sm text-muted-foreground">
                Unit: {getMetricUnit(selectedMetric)} | Source: {METRICS[selectedMetric]?.source}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedMetric(null)}>
              Close
            </Button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : (() => {
            const points = historyData[selectedMetric] || []
            // Counters record the value 1 per sample, so their stored `avg` is
            // always 1.00 — the samples-per-hour count is the real series.
            const isCountMetric = (METRICS[selectedMetric]?.display || 'avg') === 'count'

            return (
            <div className="space-y-4">
              {/* Hourly chart */}
              <div className="h-48 border rounded-md p-4">
                <MetricChart
                  data={points.map(p => isCountMetric ? p.count : p.avg)}
                  timestamps={points.map(p => p.timestamp)}
                  height={160}
                  highlightTimestamps={selectedMetric === 'db_queries_total' ? warmerHours : undefined}
                />
              </div>

              {/* Data table */}
              <div className="max-h-64 overflow-y-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background border-b">
                    <tr>
                      <th className="text-left p-2">Hour</th>
                      {!isCountMetric && <th className="text-right p-2">Average</th>}
                      <th className="text-right p-2">{isCountMetric ? getMetricUnit(selectedMetric) : 'Samples'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points
                      .slice(-50)
                      .reverse()
                      .map((point, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2 font-mono text-xs">
                            {new Date(point.timestamp).toLocaleString()}
                          </td>
                          {!isCountMetric && (
                            <td className="p-2 text-right">
                              {point.avg.toFixed(2)}
                            </td>
                          )}
                          <td className="p-2 text-right text-muted-foreground">
                            {point.count}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            )
          })()}
        </Card>
      )}

      {/* Live Data Table — collapsed by default; the cards above already
          reflect this data within a minute via the hourly history flush. */}
      <Card className="p-6">
        <button
          type="button"
          onClick={() => setLiveDataOpen(v => !v)}
          className="w-full flex items-center gap-2 text-left"
        >
          {liveDataOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <TrendingUp className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Live Data (In-Memory)</h2>
          <span className="text-sm text-muted-foreground">Last {liveData.length} minutes</span>
        </button>

        {liveDataOpen && (
          <div className="mt-4">
            {liveMetricNames.length < allMetricNames.length && (
              <p className="text-xs text-muted-foreground mb-4">
                Not shown here: {allMetricNames.filter(n => !METRICS[n].live).map(formatMetricName).join(', ')} —
                recorded in the proxy process, which has its own memory. It reaches the DB every minute, so it
                appears in the cards and history above.
              </p>
            )}

            {liveData.length === 0 ? (
              <p className="text-muted-foreground">No live data yet. Metrics will appear as they are recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left p-2">Time</th>
                      {liveMetricNames.map(name => (
                        <th key={name} className="text-right p-2 whitespace-nowrap">
                          {formatMetricName(name)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {liveData.slice(-10).reverse().map((minute, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2 font-mono text-xs">
                          {new Date(minute.timestamp).toLocaleTimeString()}
                        </td>
                        {liveMetricNames.map(name => {
                          const displayMode = METRICS[name]?.display || 'avg'
                          const data = minute.data[name]
                          return (
                            <td key={name} className="p-2 text-right">
                              {data ? (
                                <span title={`Avg: ${data.avg.toFixed(1)}, Count: ${data.count}`}>
                                  {displayMode === 'count' ? data.count : data.avg.toFixed(1)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
    </MetricsHoverProvider>
  )
}
