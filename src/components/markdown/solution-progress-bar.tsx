'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, Check, Eye, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { useCurrentSite } from '@/contexts/current-site-context'

// Class bar above a <solution> for a teacher with a class selected: who ticked
// "Done" (green), who opened the solution without (orange), who did nothing
// (grey). Copy of GeogebraProgressBar (geogebra-progress-bar.tsx) on the
// solution-responses endpoint.

/** Stored per student under `solution-<id>` (solution.tsx). */
export interface SolutionProgress {
  done: boolean
  opened: boolean
  /** The student clicked the checkbox: opening no longer ticks it. */
  manual: boolean
}

type Status = 'done' | 'opened' | 'none'

interface ResponseItem {
  studentId: string
  displayName: string
  status: Status
  updatedAt: number | null
}

interface Stats {
  done: number
  opened: number
  none: number
  total: number
}

interface SolutionProgressBarProps {
  classId: string
  className: string
  pageId: string
  componentId: string
}

export function SolutionProgressBar({ classId, className, pageId, componentId }: SolutionProgressBarProps) {
  // Site scoping: answers given on THIS site only (src/lib/site-access.ts).
  const { siteId } = useCurrentSite()
  const [stats, setStats] = useState<Stats | null>(null)
  const [responses, setResponses] = useState<ResponseItem[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchIdRef = useRef(0)
  const mountedRef = useRef(true)

  const fetchResponses = useCallback(async () => {
    const fetchId = ++fetchIdRef.current
    if (!mountedRef.current) return
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageId, componentId, siteId: siteId ?? '' })
      const res = await fetch(`/api/classes/${classId}/solution-responses?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (!mountedRef.current || fetchId !== fetchIdRef.current) return
      if (!res.ok) throw new Error('Failed to fetch responses')
      const data = await res.json()
      if (!mountedRef.current || fetchId !== fetchIdRef.current) return
      setStats(data.stats)
      setResponses(data.responses)
    } catch {
      if (mountedRef.current) setError('Failed to load class responses')
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [classId, pageId, componentId, siteId])

  // Live refresh when a student updates their work on this page.
  useRealtimeEvents(
    ['student-work-update'],
    (event) => {
      if (event.type === 'student-work-update' && event.classId === classId && event.pageId === pageId && (!event.siteId || event.siteId === siteId)) {
        fetchResponses()
      }
    },
    { enabled: true }
  )

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => { fetchResponses() }, [fetchResponses])

  if (isLoading && !stats) {
    return (
      <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-border animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-2 p-3 bg-destructive/10 text-destructive rounded-lg border border-destructive/20 text-sm">
        {error}
      </div>
    )
  }

  if (!stats) return null

  const pct = (n: number) => (stats.total > 0 ? (n / stats.total) * 100 : 0)
  const rank: Record<Status, number> = { done: 2, opened: 1, none: 0 }

  return (
    <div className="mt-4 -mb-2 rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="w-full p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{className}</span>
            <span>&bull;</span>
            <span className="text-green-600 dark:text-green-400">{stats.done} done</span>
            <span>&bull;</span>
            <span className="text-orange-600 dark:text-orange-400">{stats.opened} opened</span>
            <span>&bull;</span>
            <span>{stats.none} not yet</span>
          </div>
          {isExpanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>

        <div className="h-2 bg-muted rounded-full overflow-hidden flex">
          {stats.done > 0 && <div className="bg-green-500 transition-all duration-300" style={{ width: `${pct(stats.done)}%` }} />}
          {stats.opened > 0 && <div className="bg-orange-500 transition-all duration-300" style={{ width: `${pct(stats.opened)}%` }} />}
          {stats.none > 0 && <div className="bg-gray-300 dark:bg-gray-600 transition-all duration-300" style={{ width: `${pct(stats.none)}%` }} />}
        </div>
      </button>

      {isExpanded && (
        <div className="max-h-64 overflow-y-auto border-t border-border divide-y divide-border">
          {responses.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">No students in this class</div>
          ) : (
            responses
              .sort((a, b) => rank[b.status] - rank[a.status])
              .map(r => (
                <div
                  key={r.studentId}
                  className={cn('flex items-center gap-3 px-4 py-2 text-sm', r.status === 'none' && 'opacity-60')}
                >
                  <div className="shrink-0">
                    {r.status === 'done'
                      ? <Check className="h-4 w-4 text-green-500" />
                      : r.status === 'opened'
                        ? <Eye className="h-4 w-4 text-orange-500" />
                        : <Clock className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="shrink-0 w-32 truncate font-medium">{r.displayName}</div>
                  <div className="flex-1 text-xs text-muted-foreground">
                    {r.status === 'done' ? 'Done' : r.status === 'opened' ? 'Opened the solution, not done' : 'Not yet'}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}
