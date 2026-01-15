'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, TrendingUp, Clock, Database } from 'lucide-react'
import { formatMetricName, getMetricUnit, getMetricDisplay, METRICS, CALCULATED_METRICS, type MetricName } from '@/lib/metrics/registry'

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

  // Calculate totals for calculated metrics
  const getTotals = () => {
    const totals: Record<string, number> = {}
    for (const name of allMetricNames) {
      const liveSummary = getLiveSummary(name)
      const historySummary = getHistorySummary(name)
      const displayMode = METRICS[name]?.display || 'avg'
      if (displayMode === 'count') {
        totals[name] = (liveSummary?.count ?? 0) + (historySummary?.count ?? 0)
      }
    }
    return totals
  }

  // Calculate summary stats for a metric from live data
  const getLiveSummary = (metricName: MetricName) => {
    const values = liveData
      .map(s => s.data[metricName])
      .filter(Boolean)
      .map(d => d.avg)

    if (values.length === 0) return null

    return {
      current: values[values.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: liveData.reduce((sum, s) => sum + (s.data[metricName]?.count || 0), 0),
    }
  }

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

  // Simple sparkline component
  const Sparkline = ({ data, height = 40 }: { data: number[]; height?: number }) => {
    if (data.length === 0) return <div className="text-muted-foreground text-sm">No data</div>

    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min || 1

    const points = data
      .map((value, i) => {
        const x = (i / (data.length - 1 || 1)) * 100
        const y = height - ((value - min) / range) * height
        return `${x},${y}`
      })
      .join(' ')

    return (
      <svg width="100%" height={height} className="overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-primary"
        />
      </svg>
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

      {/* Metric Cards Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allMetricNames.map(name => {
          const liveSummary = getLiveSummary(name)
          const historySummary = getHistorySummary(name)
          const summary = liveSummary || historySummary
          const displayMode = METRICS[name as MetricName]?.display || 'avg'
          const isCountMetric = displayMode === 'count'

          // Get sparkline data from live or history (use count for count metrics)
          const sparklineData = liveData.length > 0
            ? liveData.map(s => s.data[name] ? (isCountMetric ? s.data[name].count : s.data[name].avg) : undefined).filter((v): v is number => v !== undefined)
            : (historyData[name] || []).map(p => isCountMetric ? p.count : p.avg)

          return (
            <Card
              key={name}
              className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${
                selectedMetric === name ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => setSelectedMetric(selectedMetric === name ? null : name)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-medium text-sm">{formatMetricName(name)}</h3>
                  <p className="text-xs text-muted-foreground">{getMetricUnit(name as MetricName)}</p>
                </div>
                {METRICS[name as MetricName]?.source === 'server' ? (
                  <Database className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {summary ? (
                <>
                  <div className="text-2xl font-bold mb-2">
                    {isCountMetric ? summary.count : summary.current.toFixed(1)}
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      {getMetricUnit(name as MetricName)}
                    </span>
                  </div>
                  <div className="h-10 mb-2">
                    <Sparkline data={sparklineData} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    {isCountMetric ? (
                      <span>Total: {summary.count}</span>
                    ) : (
                      <>
                        <span>Avg: {summary.avg.toFixed(1)}</span>
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
        <h2 className="text-lg font-semibold">Calculated Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(CALCULATED_METRICS).map(([key, metric]) => {
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
          ) : (
            <div className="space-y-4">
              {/* Large sparkline */}
              <div className="h-32 border rounded-md p-4">
                <Sparkline
                  data={(historyData[selectedMetric] || []).map(p => p.avg)}
                  height={100}
                />
              </div>

              {/* Data table */}
              <div className="max-h-64 overflow-y-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background border-b">
                    <tr>
                      <th className="text-left p-2">Timestamp</th>
                      <th className="text-right p-2">Average</th>
                      <th className="text-right p-2">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historyData[selectedMetric] || [])
                      .slice(-50)
                      .reverse()
                      .map((point, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2 font-mono text-xs">
                            {new Date(point.timestamp).toLocaleString()}
                          </td>
                          <td className="p-2 text-right">
                            {point.avg.toFixed(2)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {point.count}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Live Data Table */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Live Data (In-Memory)</h2>
          <span className="text-sm text-muted-foreground">Last {liveData.length} minutes</span>
        </div>

        {liveData.length === 0 ? (
          <p className="text-muted-foreground">No live data yet. Metrics will appear as they are recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left p-2">Time</th>
                  {allMetricNames.map(name => (
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
                    {allMetricNames.map(name => {
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
      </Card>
    </div>
  )
}
