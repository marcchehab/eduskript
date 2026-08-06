'use client'

/**
 * Awake-time card for the metrics panel.
 *
 * The managed Postgres bills the wall-clock time it spends awake, not the
 * queries it answers, so this is the number that maps to the invoice. The
 * per-hour strip matters as much as the headline: a flat 60/60 across the night
 * means something is polling on a timer, while a few tall bars during the day
 * is normal use. See src/lib/metrics/db-awake.ts for the estimate's limits.
 */

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Moon } from 'lucide-react'

interface AwakeResponse {
  hours: number
  suspendMinutes: number
  window: {
    from: string
    to: string
    awakeMinutes: number
    totalMinutes: number
    activeMinutes: number
    fraction: number
  }
  byHour: Array<{ hour: string; awakeMinutes: number; activeMinutes: number }>
}

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

export function DbAwakeCard() {
  const [data, setData] = useState<AwakeResponse | null>(null)
  const [hours, setHours] = useState(24)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/metrics/db-awake?hours=${hours}`)
      if (!res.ok) throw new Error('Failed to load awake time')
      setData(await res.json())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }, [hours])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const percent = data ? Math.round(data.window.fraction * 100) : null
  const awakeHours = data ? data.window.awakeMinutes / 60 : 0
  const totalHours = data ? data.window.totalMinutes / 60 : 0

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-medium text-sm">Database Awake Time</h3>
          <p className="text-xs text-muted-foreground">
            Billed wall-clock, not query count
          </p>
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map(r => (
            <Button
              key={r.hours}
              variant={hours === r.hours ? 'default' : 'outline'}
              size="sm"
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </Button>
          ))}
          <Moon className="h-4 w-4 text-muted-foreground ml-1" />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && !error && (
        <>
          <div className="text-2xl font-bold mb-1">
            {percent}%
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {awakeHours.toFixed(1)}h of {totalHours.toFixed(0)}h
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {data.window.activeMinutes} minutes actually saw a query; each keeps the
            instance up for {data.suspendMinutes} more.
          </p>

          {/* One bar per hour, full height = awake the whole hour. */}
          <div className="flex items-end gap-px h-12" title="Awake minutes per hour">
            {data.byHour.map(h => (
              <div
                key={h.hour}
                className="flex-1 bg-muted rounded-sm relative min-w-px"
                style={{ height: '100%' }}
              >
                <div
                  className="absolute bottom-0 left-0 right-0 bg-primary rounded-sm"
                  style={{ height: `${(h.awakeMinutes / 60) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{new Date(data.window.from).toLocaleString()}</span>
            <span>now</span>
          </div>
        </>
      )}

      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
    </Card>
  )
}
