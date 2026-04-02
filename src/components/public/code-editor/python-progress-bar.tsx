'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, Check, X, Clock, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'

interface PythonResponseItem {
  studentId: string
  displayName: string
  testsPassed: number | null
  totalTests: number | null
  earnedPoints: number | null
  submittedAt: number | null
}

interface PythonStats {
  fullPass: number
  partialPass: number
  failed: number
  notAttempted: number
  total: number
  averageScore: number
}

interface PythonProgressBarProps {
  classId: string
  className: string
  pageId: string
  componentId: string
}

export function PythonProgressBar({ classId, className, pageId, componentId }: PythonProgressBarProps) {
  const [stats, setStats] = useState<PythonStats | null>(null)
  const [responses, setResponses] = useState<PythonResponseItem[]>([])
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
      const params = new URLSearchParams({ pageId, componentId })
      const res = await fetch(`/api/classes/${classId}/python-responses?${params}`, {
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
  }, [classId, pageId, componentId])

  useRealtimeEvents(
    ['student-work-update'],
    (event) => {
      if (event.type === 'student-work-update' && event.classId === classId && event.pageId === pageId) {
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

  const attempted = stats.fullPass + stats.partialPass + stats.failed
  const fullPassWidth = stats.total > 0 ? (stats.fullPass / stats.total) * 100 : 0
  const partialWidth = stats.total > 0 ? (stats.partialPass / stats.total) * 100 : 0
  const failedWidth = stats.total > 0 ? (stats.failed / stats.total) * 100 : 0
  const notAttemptedWidth = stats.total > 0 ? (stats.notAttempted / stats.total) * 100 : 0

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="w-full p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{className}</span>
            <span>&bull;</span>
            <span>{attempted}/{stats.total} versucht</span>
            {stats.fullPass > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-green-600 dark:text-green-400">{stats.fullPass} alle bestanden</span>
              </>
            )}
            {stats.partialPass > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-yellow-600 dark:text-yellow-400">{stats.partialPass} teilweise</span>
              </>
            )}
            {stats.averageScore > 0 && (
              <>
                <span>&bull;</span>
                <span>{Math.round(stats.averageScore)}% Durchschnitt</span>
              </>
            )}
          </div>
          {isExpanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>

        {/* Three-segment progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden flex">
          {fullPassWidth > 0 && (
            <div className="bg-green-500 transition-all duration-300" style={{ width: `${fullPassWidth}%` }} />
          )}
          {partialWidth > 0 && (
            <div className="bg-yellow-500 transition-all duration-300" style={{ width: `${partialWidth}%` }} />
          )}
          {failedWidth > 0 && (
            <div className="bg-red-500 transition-all duration-300" style={{ width: `${failedWidth}%` }} />
          )}
          {notAttemptedWidth > 0 && (
            <div className="bg-gray-300 dark:bg-gray-600 transition-all duration-300" style={{ width: `${notAttemptedWidth}%` }} />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="max-h-64 overflow-y-auto border-t border-border divide-y divide-border">
          {responses.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              Keine Schüler in dieser Klasse
            </div>
          ) : (
            responses
              .sort((a, b) => {
                // Sort by score descending, unattempted last
                const score = (r: PythonResponseItem) =>
                  r.totalTests === null ? -1 : (r.testsPassed ?? 0) / (r.totalTests || 1)
                return score(b) - score(a)
              })
              .map(r => {
                const percentage = r.totalTests ? Math.round(((r.testsPassed ?? 0) / r.totalTests) * 100) : null
                return (
                  <div
                    key={r.studentId}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2 text-sm',
                      r.totalTests === null && 'opacity-60'
                    )}
                  >
                    <div className="flex-shrink-0">
                      {r.totalTests === null
                        ? <Clock className="h-4 w-4 text-muted-foreground" />
                        : r.testsPassed === r.totalTests
                          ? <Check className="h-4 w-4 text-green-500" />
                          : (r.testsPassed ?? 0) > 0
                            ? <Minus className="h-4 w-4 text-yellow-500" />
                            : <X className="h-4 w-4 text-red-500" />}
                    </div>
                    <div className="flex-shrink-0 w-32 truncate font-medium">{r.displayName}</div>
                    <div className="flex-1 text-xs text-muted-foreground">
                      {r.totalTests === null
                        ? 'Noch kein Versuch'
                        : `${r.testsPassed}/${r.totalTests} Tests (${percentage}%)`}
                    </div>
                  </div>
                )
              })
          )}
        </div>
      )}
    </div>
  )
}
